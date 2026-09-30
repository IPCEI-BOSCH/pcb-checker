import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ClipboardCheck, FileCheck2, Settings2, UserPlus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { fetchMyStudent } from "@/lib/data";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Panou — PCB Checker UPB" },
      { name: "description", content: "Panoul personal PCB Checker: self-check, predări și evaluări." },
      { property: "og:title", content: "Panou — PCB Checker UPB" },
      { property: "og:description", content: "Panoul personal PCB Checker." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { user, has, isStaff } = useAuth();
  const student = useQuery({ queryKey: ["my-student", user.id], queryFn: () => fetchMyStudent(user.id) });
  const subs = useQuery({
    queryKey: ["my-subs", user.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("submissions").select("id, kind, revision, drc_score, blocking_count, review_status, created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(5);
      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Bun venit{user.user_metadata?.["full_name"] ? `, ${user.user_metadata["full_name"]}` : ""}</h1>
        <p className="text-sm text-muted-foreground">{user.email}</p>
      </div>

      {!isStaff && !has("student") && (
        <Card className="border-warning/50">
          <CardContent className="pt-6 text-sm text-muted-foreground">
            Contul tău nu are încă un rol didactic. Dacă ești student, înscrie-te într-o grupă. Cadrele didactice primesc rolul de la administrator sau managerul de serie.
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {(has("student") || !isStaff) && (
          <>
            <QuickCard to="/self-check" icon={FileCheck2} title="Self-Check" desc="Verifică arhiva Gerber și predă oficial." />
            <QuickCard to="/enroll" icon={UserPlus} title="Înscriere" desc={student.data ? `Grupa ${student.data.groups?.name ?? ""}` : "Alege seria și grupa."} />
          </>
        )}
        {has("admin", "series_manager", "instructor") && <QuickCard to="/review" icon={ClipboardCheck} title="Evaluare grupe" desc="Predări, DRC pe lot, aprobări." />}
        {has("admin", "series_manager") && <QuickCard to="/admin" icon={Settings2} title="Administrare" desc="Serii, grupe, roluri, studenți." />}
      </div>

      {student.data && (
        <Card>
          <CardHeader><CardTitle className="text-base">Proiectul meu</CardTitle></CardHeader>
          <CardContent className="grid gap-2 text-sm sm:grid-cols-4">
            <Info k="Serie / Grupă" v={`${student.data.groups?.series?.name ?? "—"} / ${student.data.groups?.name ?? "—"}`} />
            <Info k="Variantă" v={student.data.variant === "SMT" ? "a — SMT/SMD" : "b — THT"} />
            <Info k="Temă" v={student.data.theme_name ? `${student.data.theme_name} · Nr. ${student.data.theme_number ?? "—"}` : "—"} />
            <Info k="Status înscriere" v={student.data.status === "approved" ? "Validată" : "În așteptare"} />
          </CardContent>
        </Card>
      )}

      {!!subs.data?.length && (
        <Card>
          <CardHeader><CardTitle className="text-base">Ultimele verificări</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {subs.data.map((s) => (
              <div key={s.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
                <span className="font-mono text-muted-foreground">Rev.{s.revision} · {new Date(s.created_at).toLocaleString("ro-RO")}</span>
                <span className="flex items-center gap-2">
                  <Badge variant={s.kind === "OFFICIAL" ? "default" : "secondary"}>{s.kind === "OFFICIAL" ? "Predare oficială" : "Self-check"}</Badge>
                  <span className="font-mono">{s.drc_score ?? "—"}/100</span>
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function QuickCard({ to, icon: Icon, title, desc }: { to: "/self-check" | "/enroll" | "/review" | "/admin"; icon: typeof FileCheck2; title: string; desc: string }) {
  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-2"><Icon className="h-5 w-5 text-primary" /><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent className="flex flex-1 flex-col justify-between gap-3">
        <p className="text-sm text-muted-foreground">{desc}</p>
        <Button asChild variant="secondary" size="sm"><Link to={to}>Deschide</Link></Button>
      </CardContent>
    </Card>
  );
}

function Info({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{k}</div>
      <div className="text-foreground">{v}</div>
    </div>
  );
}
