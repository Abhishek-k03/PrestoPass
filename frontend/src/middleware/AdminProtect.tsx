import React, { ReactNode } from "react";
import { useAuth } from "../context/AuthContext";
import { ROLE } from "../lib/types";
import { redirect } from "next/navigation";

const AdminProtect = ({ children }: { children: ReactNode }) => {
  const { user, loading } = useAuth();

  if (loading) {
    return null;
  }

  if (!user || user.role !== ROLE.ADMIN) {
    redirect("/events");
  }

  return <>{children}</>;
};

export default AdminProtect;
