import { useAuth } from "@clerk/clerk-react";
import { useEffect } from "react";
import { setAuthTokenGetter } from "@workspace/api-client-react";

export function useAuthSync() {
  const { getToken } = useAuth();
  
  useEffect(() => {
    setAuthTokenGetter(async () => {
      try {
        return await getToken();
      } catch (e) {
        return null;
      }
    });
  }, [getToken]);
}