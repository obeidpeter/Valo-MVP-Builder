import { useListUsers, useUpdateUser, getListUsersQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Shield, Info } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { UserUpdateRole, UserUpdateStatus } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";

export default function Settings() {
  const { data: users, isLoading } = useListUsers();
  const updateUser = useUpdateUser();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const refresh = () => queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
  const onError = () => toast({ variant: "destructive", title: "Could not update user" });

  const handleRoleChange = (id: string, role: UserUpdateRole) => {
    updateUser.mutate({ id, data: { role } }, { onSuccess: refresh, onError });
  };

  const handleStatusChange = (id: string, status: UserUpdateStatus) => {
    updateUser.mutate({ id, data: { status } }, { onSuccess: refresh, onError });
  };

  return (
    <div className="p-8 max-w-5xl mx-auto w-full space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-3xl font-serif tracking-tight font-semibold">System Settings</h1>
        <p className="text-muted-foreground mt-1">Manage personnel access and system configuration.</p>
      </div>

      <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900 rounded-lg p-4 flex gap-3">
        <Info className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <h3 className="font-medium text-blue-900 dark:text-blue-300">Data Retention & Security</h3>
          <p className="text-sm text-blue-800 dark:text-blue-400/80 leading-relaxed">
            All tender documents and extracted evidence are stored in encrypted GCS buckets. 
            API keys for OpenAI and other services are managed securely via environment secrets.
            Do not share the publishable key or environment endpoints publicly.
          </p>
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-foreground" />
          <h2 className="text-xl font-serif tracking-tight font-medium">Personnel Management</h2>
        </div>

        <div className="bg-card border border-border rounded-lg shadow-xs overflow-hidden">
          {isLoading ? (
            <div className="p-12 flex justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : users && users.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead className="font-mono text-xs uppercase tracking-wider">User</TableHead>
                  <TableHead className="font-mono text-xs uppercase tracking-wider">Role</TableHead>
                  <TableHead className="font-mono text-xs uppercase tracking-wider">Status</TableHead>
                  <TableHead className="font-mono text-xs uppercase tracking-wider">Joined</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell>
                      <div className="font-medium">{user.name || "Unnamed"}</div>
                      <div className="text-xs text-muted-foreground">{user.email}</div>
                    </TableCell>
                    <TableCell>
                      <Select 
                        defaultValue={user.role} 
                        onValueChange={(val: UserUpdateRole) => handleRoleChange(user.id, val)}
                      >
                        <SelectTrigger className="w-[140px] h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="admin">Admin</SelectItem>
                          <SelectItem value="reviewer">Reviewer</SelectItem>
                          <SelectItem value="analyst">Analyst</SelectItem>
                          <SelectItem value="none">None</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Select 
                        defaultValue={user.status} 
                        onValueChange={(val: UserUpdateStatus) => handleStatusChange(user.id, val)}
                      >
                        <SelectTrigger className="w-[120px] h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="active">Active</SelectItem>
                          <SelectItem value="disabled">Disabled</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {user.createdAt ? new Date(user.createdAt).toLocaleDateString() : "-"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="p-8 text-center text-muted-foreground">
              No users found or permission denied.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}