/**
 * NotFoundRedirect — shown when a route's resource (chat / run / workspace)
 * no longer exists. Fires a toast and bounces the user home instead of
 * leaving them on a broken, empty screen.
 */
import { useEffect } from "react";
import { Navigate } from "react-router-dom";
import { useToast } from "./ui/Toast";
import { useT } from "../lib/i18n";

export function NotFoundRedirect() {
  const { toast } = useToast();
  const { t } = useT();
  useEffect(() => {
    toast({ title: t("common.notFound"), variant: "error" });
  }, [toast, t]);
  return <Navigate to="/" replace />;
}
