import { useAuth } from "@/contexts/AuthContext";
import LoginPage from "@/pages/LoginPage";
import LoadingScreen from "./LoadingScreen";
import PreAppSupport from "./PreAppSupport";

/**
 * Wraps children and only renders them if the user is authenticated.
 * Shows the login screen otherwise.
 */
export default function AuthGate({ children }: { children: React.ReactNode }) {
  const { authenticated, loading } = useAuth();

  console.log("[AuthGate] render — authenticated:", authenticated, "loading:", loading);

  if (loading) {
    return <LoadingScreen variant="fullscreen" label="Authenticating…" />;
  }

  if (!authenticated) {
    return (
      <>
        <LoginPage />
        <PreAppSupport />
      </>
    );
  }

  return <>{children}</>;
}
