import { createContext, useContext } from "react";
import type { User } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type AppRole = Database["public"]["Enums"]["app_role"];

export interface AuthCtx {
  user: User;
  roles: AppRole[];
  has: (...r: AppRole[]) => boolean;
  isStaff: boolean;
}

export const AuthContext = createContext<AuthCtx | null>(null);

export function useAuth() {
  const v = useContext(AuthContext);
  if (!v) throw new Error("useAuth outside authenticated layout");
  return v;
}

export const ROLE_LABELS: Record<AppRole, string> = {
  admin: "Administrator General",
  series_manager: "Manager de Serie",
  instructor: "Îndrumător de Grupă",
  student: "Student",
  cam_tech: "Tehnician CAM",
};
