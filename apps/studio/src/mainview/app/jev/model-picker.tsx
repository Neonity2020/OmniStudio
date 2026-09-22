/**
 * 侧栏顶部的判定模型选择：本地部署 / 云端 API，以及具体用哪个模型。
 *
 * 为什么放侧栏而不是只留在主区的「判定引擎」面板里：判定台和演练场都在用同一个
 * 模型，而"现在跑的是哪个模型"是看结果时最先要确认的事 —— 尤其是同一台网关后面
 * 挂着好几个判定服务（实测过同一套请求在不同模型上，一个 8 步走到终点、一个 20 步
 * 全撞墙）。选择写的就是 `SYSTEMONE_BACKEND` / `SYSTEMONE_*_MODEL`，和主区面板
 * 改的是同一份设置，两处永远一致。
 *
 * 云端的模型清单来自「自动发现」：读一遍 Base URL 上的 `/v1/models`。发现不到
 * （地址没配、Key 没放行）就退回内置的官方模型名，至少不会只剩一个空下拉。
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CloudIcon, CpuIcon, Loader2Icon, SearchIcon } from "lucide-react";

import { rpcClient } from "@lib/rpc";
import { useJevStore, type JevEngineTab } from "@stores/jev";
import { useT } from "@stores/ui-lang";
import { Button } from "@ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ui/select";
import { cn } from "@/mainview/lib/utils";

/** tab → 后端设置值（和主区面板同一套映射）。 */
const BACKEND_FOR_TAB: Record<JevEngineTab, string> = { local: "local", cloud: "cloud" };

export function JevModelPicker() {
  const t = useT();
  const queryClient = useQueryClient();
  const tab = useJevStore((s) => s.engineTab);
  const setTab = useJevStore((s) => s.setEngineTab);
  const status = useQuery({ queryKey: ["systemone", "status"], queryFn: () => rpcClient.systemoneStatus(undefined) });
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => rpcClient.getSettings(undefined) });

  const save = useMutation({
    mutationFn: (patch: Record<string, string>) => rpcClient.updateSettings({ settings: patch }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
      void queryClient.invalidateQueries({ queryKey: ["systemone", "status"] });
    },
  });
  const discover = useMutation({ mutationFn: () => rpcClient.systemoneDiscover(undefined) });

  const cloudModel = settings.data?.settings.SYSTEMONE_CLOUD_MODEL ?? "";
  const localModel = settings.data?.settings.SYSTEMONE_LOCAL_MODEL ?? "";
  const current = tab === "cloud" ? cloudModel : localModel;

  /** 候选模型：发现到的 > 内置清单 > 当前这一个（手填的名字不能从清单里消失）。 */
  const options = (() => {
    const names =
      tab === "cloud"
        ? [
            ...(discover.data?.models.jev ?? []).map((m) => m.name),
            ...(discover.data?.models.others ?? []).map((m) => m.name),
            ...(status.data?.models ?? []).filter((m) => m.backend === "cloud").map((m) => m.name),
          ]
        : [
            ...(status.data?.localModels ?? []).map((m) => m.name),
            ...(status.data?.models ?? []).filter((m) => m.backend === "local").map((m) => m.name),
          ];
    if (current) names.unshift(current);
    return [...new Set(names.filter(Boolean))];
  })();

  const pickTab = (next: JevEngineTab) => {
    setTab(next);
    save.mutate({ SYSTEMONE_BACKEND: BACKEND_FOR_TAB[next] });
  };

  return (
    <div className="flex flex-none flex-col gap-1.5 px-2 pt-2">
      <span className="px-0.5 text-[11px] font-semibold text-muted-foreground">{t("jev.picker.title")}</span>

      <div className="flex gap-1 rounded-lg bg-muted p-1" role="tablist">
        {(["local", "cloud"] as JevEngineTab[]).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            className={cn(
              "flex flex-1 items-center justify-center gap-1 rounded-md px-1.5 py-1 text-[11px] transition-colors",
              tab === value ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => pickTab(value)}
          >
            {value === "local" ? <CpuIcon className="size-3" aria-hidden /> : <CloudIcon className="size-3" aria-hidden />}
            {t(value === "local" ? "jev.picker.local" : "jev.picker.cloud")}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1">
        <Select value={current || undefined} onValueChange={(value) => save.mutate(tab === "cloud" ? { SYSTEMONE_CLOUD_MODEL: value } : { SYSTEMONE_LOCAL_MODEL: value })}>
          <SelectTrigger className="h-7 min-w-0 flex-1 text-[11px]">
            <SelectValue placeholder={t("jev.picker.placeholder")} />
          </SelectTrigger>
          <SelectContent className="max-w-72">
            {options.map((name) => (
              <SelectItem key={name} value={name}>
                <span className="truncate font-mono text-[11px]">{name}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {tab === "cloud" ? (
          <Button
            size="sm"
            variant="outline"
            className="size-7 flex-none p-0"
            title={t("systemone.discover")}
            aria-label={t("systemone.discover")}
            disabled={discover.isPending}
            onClick={() => discover.mutate()}
          >
            {discover.isPending ? (
              <Loader2Icon className="size-3 animate-spin" aria-hidden />
            ) : (
              <SearchIcon className="size-3" aria-hidden />
            )}
          </Button>
        ) : null}
      </div>

      {/* 选了云端却还没配 Key，这里先说一声 —— 否则要等到跑出 403 才知道。 */}
      {tab === "cloud" && status.data && !status.data.cloudConfigured ? (
        <span className="px-0.5 text-[10px] leading-4 text-muted-foreground">{t("jev.picker.needKey")}</span>
      ) : null}
    </div>
  );
}
