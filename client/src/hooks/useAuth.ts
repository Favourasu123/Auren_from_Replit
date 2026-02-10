// Replit Auth hook (from blueprint: javascript_log_in_with_replit)
import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";
import type { User } from "@shared/schema";

export function useAuth() {
  const { data: user, isLoading } = useQuery<User | null>({
    queryKey: ["/api/auth/user"],
    queryFn: getQueryFn<User | null>({ on401: "returnNull" }),
  });

  return {
    user: user ?? undefined,
    isLoading,
    isAuthenticated: !!user,
  };
}
