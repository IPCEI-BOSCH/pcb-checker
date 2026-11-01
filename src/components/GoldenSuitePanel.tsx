import { useState } from "react";
import { CheckCircle2, FlaskConical, Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { runGoldenSuite, type GoldenResult } from "@/lib/gerber/__tests__/goldenSuite";
import { cn } from "@/lib/utils";

/** Rulează cele 12 benchmark-uri sintetice ale parserului și motorului DRC, direct în browser. */
export function GoldenSuitePanel() {
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<GoldenResult[] | null>(null);

  const run = async () => {
    setRunning(true);
    setResults(null);
    const out: GoldenResult[] = [];
    await runGoldenSuite((_done, _total, r) => {
      out.push(r);
      setResults([...out]);
    });
    setRunning(false);
  };

  const passed = results?.filter((r) => r.ok).length ?? 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-base"><FlaskConical className="h-4 w-4" /> Golden Suite — benchmark-uri parser & DRC</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            12 plăci sintetice generate în memorie validează parserul Gerber/Excellon și regulile DRC end-to-end. Rulează local, fără upload.
          </p>
        </div>
        <Button onClick={run} disabled={running} size="sm">
          {running ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
          {running ? "Se rulează…" : results ? "Rulează din nou" : "Rulează suite-ul"}
        </Button>
      </CardHeader>
      {results && (
        <CardContent className="space-y-2">
          <div className="flex items-center gap-2 text-sm">
            {passed === results.length ? (
              <Badge className="bg-green-600 text-white hover:bg-green-600">{passed}/{results.length} PASS</Badge>
            ) : (
              <Badge variant="destructive">{passed}/{results.length} PASS</Badge>
            )}
            <span className="text-xs text-muted-foreground">total {results.reduce((a, r) => a + r.ms, 0)} ms</span>
          </div>
          <div className="divide-y divide-border rounded-md border border-border">
            {results.map((r) => (
              <div key={r.name} className="flex items-start gap-3 p-2.5 text-sm">
                {r.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn("font-medium", r.ok ? "text-foreground" : "text-destructive")}>{r.name}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">{r.ms} ms</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{r.description}</p>
                  {r.failures.map((f, i) => (
                    <p key={i} className="mt-0.5 font-mono text-xs text-destructive">✗ {f}</p>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      )}
    </Card>
  );
}
