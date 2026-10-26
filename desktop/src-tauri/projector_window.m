// projector_window.m — Studio projectors on a second screen (macOS).
//
// macOS "native" full screen moves a window into its own Space, so another
// app's full-screen window on that screen (an OBS Program Projector, for
// example) can stay in front, and bringing ours back means stealing focus.
// Instead the projector covers the screen as a borderless window above other
// apps' windows and the menu bar, on every Space, without taking the keyboard.
//
// Because it sits above everything, it must never end up on another screen:
// the moment its screen is unplugged (or the cable wobbles) it is hidden, and
// the app then closes it. Otherwise macOS would move it onto the laptop's
// screen, covering everything with no way to reach it.
#import <Cocoa/Cocoa.h>
#import <objc/runtime.h>

static char kScreenObserverKey;
static char kCloseObserverKey;

static NSNumber *screenNumber(NSScreen *screen) {
    return screen.deviceDescription[@"NSScreenNumber"];
}

static BOOL screenIsConnected(NSNumber *number) {
    for (NSScreen *screen in [NSScreen screens]) {
        if ([screenNumber(screen) isEqual:number]) return YES;
    }
    return NO;
}

/** Hide it now (no animation, no longer above everything); the app closes it right after. */
static void stand_down(NSWindow *window) {
    window.level = NSNormalWindowLevel;
    window.collectionBehavior = NSWindowCollectionBehaviorDefault;
    [window orderOut:nil];
}

static void watch_screen(NSWindow *window, NSNumber *number) {
    NSNotificationCenter *center = [NSNotificationCenter defaultCenter];
    id previous = objc_getAssociatedObject(window, &kScreenObserverKey);
    if (previous != nil) [center removeObserver:previous];

    __weak NSWindow *weakWindow = window;
    id observer = [center addObserverForName:NSApplicationDidChangeScreenParametersNotification
                                      object:nil
                                       queue:[NSOperationQueue mainQueue]
                                  usingBlock:^(__unused NSNotification *note) {
        NSWindow *strong = weakWindow;
        if (strong == nil) return;
        // Gone, or macOS already moved the window onto a different screen.
        if (!screenIsConnected(number) || ![screenNumber(strong.screen) isEqual:number]) {
            stand_down(strong);
        }
    }];
    objc_setAssociatedObject(window, &kScreenObserverKey, observer, OBJC_ASSOCIATION_RETAIN_NONATOMIC);

    if (objc_getAssociatedObject(window, &kCloseObserverKey) == nil) {
        id closeObserver = [center addObserverForName:NSWindowWillCloseNotification
                                               object:window
                                                queue:[NSOperationQueue mainQueue]
                                           usingBlock:^(NSNotification *note) {
            NSWindow *closing = note.object;
            id screenObserver = objc_getAssociatedObject(closing, &kScreenObserverKey);
            if (screenObserver != nil) [[NSNotificationCenter defaultCenter] removeObserver:screenObserver];
            id selfObserver = objc_getAssociatedObject(closing, &kCloseObserverKey);
            if (selfObserver != nil) [[NSNotificationCenter defaultCenter] removeObserver:selfObserver];
            objc_setAssociatedObject(closing, &kScreenObserverKey, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
            objc_setAssociatedObject(closing, &kCloseObserverKey, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
        }];
        objc_setAssociatedObject(window, &kCloseObserverKey, closeObserver, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    }
}

void mce_projector_cover_screen(void *ns_window) {
    NSWindow *window = (__bridge NSWindow *)ns_window;
    if (window == nil) return;
    NSScreen *screen = window.screen ?: [NSScreen mainScreen];
    if (screen == nil) return;

    // A window already in native full screen (opened by an older version) is left as it is.
    if ((window.styleMask & NSWindowStyleMaskFullScreen) != 0) return;
    window.styleMask = NSWindowStyleMaskBorderless;
    window.level = NSScreenSaverWindowLevel;
    window.collectionBehavior = NSWindowCollectionBehaviorCanJoinAllSpaces
        | NSWindowCollectionBehaviorStationary
        | NSWindowCollectionBehaviorFullScreenAuxiliary
        | NSWindowCollectionBehaviorIgnoresCycle;
    window.hidesOnDeactivate = NO;
    [window setFrame:screen.frame display:YES];
    watch_screen(window, screenNumber(screen));
    [window orderFrontRegardless];
}

/** Bring it back in front of whatever is on that screen, still without taking the keyboard. */
void mce_projector_raise(void *ns_window) {
    NSWindow *window = (__bridge NSWindow *)ns_window;
    if (window == nil || !window.visible) return;
    [window orderFrontRegardless];
}
