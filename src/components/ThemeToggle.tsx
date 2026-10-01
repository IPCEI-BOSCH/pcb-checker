import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Light/dark switch; the choice is kept in localStorage and applied as a class on <html>. */
export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const [light, setLight] = useState(false);
  useEffect(() => { setLight(document.documentElement.classList.contains("light")); }, []);
  const toggle = () => {
    const next = !light;
    setLight(next);
    document.documentElement.classList.toggle("light", next);
    window.localStorage.setItem("theme", next ? "light" : "dark");
  };
  const Icon = light ? Moon : Sun;
  if (compact) return <button onClick={toggle} className="p-2 text-muted-foreground" aria-label={light ? "Mod întunecat" : "Mod luminos"}><Icon className="h-4 w-4" /></button>;
  return (
    <Button variant="ghost" size="sm" className="mt-1 w-full justify-start" onClick={toggle}>
      <Icon className="mr-2 h-4 w-4" /> {light ? "Mod întunecat" : "Mod luminos"}
    </Button>
  );
}
