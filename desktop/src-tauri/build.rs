fn main() {
    // The licence public key is compiled into the binary (see license_verify.rs).
    println!("cargo:rerun-if-env-changed=VITE_SUBSCRIPTION_PUBLIC_KEY");
    if std::env::var("PROFILE").map(|p| p == "release").unwrap_or(false)
        && std::env::var("VITE_SUBSCRIPTION_PUBLIC_KEY").map(|v| v.trim().is_empty()).unwrap_or(true)
    {
        println!("cargo:warning=VITE_SUBSCRIPTION_PUBLIC_KEY is not set: this release build will reject every signed licence (everyone runs as Free).");
    }
    tauri_build::build();

    #[cfg(target_os = "macos")]
    {
        // Find the macOS SDK so the compiler can resolve Cocoa/AppKit headers.
        let sdk_path = std::process::Command::new("xcrun")
            .args(["--show-sdk-path"])
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .map(|s| s.trim().to_string())
            .unwrap_or_else(|| "/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk".into());

        cc::Build::new()
            .file("macos_icon.m")
            .flag("-ObjC")
            .flag("-isysroot")
            .flag(&sdk_path)
            .compile("macos_icon");

        // NDI out: snapshots of the hidden Studio output window (studio_ndi_out.rs).
        cc::Build::new()
            .file("ndi_out_snapshot.m")
            .flag("-fobjc-arc")
            .flag("-isysroot")
            .flag(&sdk_path)
            .compile("ndi_out_snapshot");
        println!("cargo:rerun-if-changed=ndi_out_snapshot.m");

        // Studio projectors on a second screen: above other windows, no own Space (lib.rs present_studio_projector).
        cc::Build::new()
            .file("projector_window.m")
            .flag("-fobjc-arc")
            .flag("-isysroot")
            .flag(&sdk_path)
            .compile("projector_window");
        println!("cargo:rerun-if-changed=projector_window.m");

        // Link Cocoa framework at the linker stage (cc only compiles, not links).
        println!("cargo:rustc-link-lib=framework=Cocoa");
        println!("cargo:rustc-link-lib=framework=WebKit");
        println!("cargo:rustc-link-lib=framework=Accelerate");
    }
}
