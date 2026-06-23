import { useState } from "react";
import { KeyRound } from "lucide-react";
import { Input } from "@/components/ui/input";
import { getStoredAdminToken, setStoredAdminToken } from "@/lib/adminToken";

export default function AdminTokenField() {
  const [token, setToken] = useState(getStoredAdminToken);

  const persist = (value: string) => {
    setToken(value);
    setStoredAdminToken(value);
  };

  return (
    <div className="relative w-52 hidden lg:block">
      <KeyRound className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="password"
        value={token}
        onChange={(e) => persist(e.target.value)}
        autoComplete="off"
        placeholder="Admin token"
        title="INGEST_ADMIN_TOKEN — required for create/edit/delete"
        className="h-9 rounded-sm pl-9 text-sm font-mono"
      />
    </div>
  );
}
