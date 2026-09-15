import { useQuery } from "@tanstack/react-query";
import { CpuIcon } from "lucide-react";
import { rpcClient } from "@lib/rpc";
import { useEngine } from "@lib/use-engine";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ui/select";
import { useT } from "@stores/ui-lang";
import { ENGINE_OPTIONS, type InferenceEngine } from "@/shared/modelscope";

// ---------------------------------------------------------------------------
// 引擎选择
// ---------------------------------------------------------------------------

export function EngineSelector() {
  const t = useT();
  const { engine, setEngine, isSaving } = useEngine();
  const { data } = useQuery({
    queryKey: ["settings"],
    queryFn: () => rpcClient.getSettings(undefined),
  });
  // MLX 只面向 macOS，非 mac 不展示该引擎选项。
  const isMac = data?.platform === "darwin";
  const options = ENGINE_OPTIONS.filter((o) => o.value !== "mlx" || isMac);

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <CpuIcon className="size-3.5" />
        {t("settings.engine")}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Select value={engine} onValueChange={(v) => setEngine(v as InferenceEngine)} disabled={isSaving}>
          <SelectTrigger className="h-8 w-72 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((o) => (
              <SelectItem key={o.value} value={o.value}>{t(o.labelKey)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[11px] text-muted-foreground">{t("models.engineHint")}</p>
      </div>
    </div>
  );
}
