/**
 * 左栏顶部的「判定引擎」切换 + 对应配置 —— 位置与交互对齐语音合成页的「推理引擎」：
 * 一排分段按钮，选中项下方给一句人话说明，再往下是该引擎要配的东西。
 *
 * 两个引擎的区别值得写清楚，因为它不是"本地/云端"那么对称：
 * - 本地运行：免费的离线权重（laya-mlx）。要装引擎、下权重、启动模型，慢一点但完全离线；
 * - 云端接入：打 TypeSafe 官方（或任何同协议的地址），要配 Key，不占本机内存。
 *
 * 本地这侧的模型行就是"下载这个模型、下载这个引擎、启动这个模型"三件事的落点。
 */
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2Icon,
  CpuIcon,
  CloudIcon,
  DownloadIcon,
  Loader2Icon,
  PlayIcon,
  SquareIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react";

import { rpcClient } from "@lib/rpc";
import { useT } from "@stores/ui-lang";
import { useJevStore } from "@stores/jev";
import { useSystemOneInstallStore } from "@stores/systemone-install";
import { Button } from "@ui/button";
import { Input } from "@ui/input";
import { cn } from "@/mainview/lib/utils";
import type { SystemOneAvailability } from "../../../bun/systemone";

type EngineTab = "local" | "cloud";

/** tab → 设置值：选哪个 tab 就走哪条后端，不再让 `auto` 偷偷改写用户的选择。 */
const BACKEND_FOR_TAB: Record<EngineTab, string> = { local: "local", cloud: "cloud" };

/** 设置值 → tab：`auto`（用户还没选过）时按当前解析结果落在实际会用的那侧。 */
function tabForBackend(backend: string, resolved: string | null): EngineTab {
  if (backend === "local" || backend === "cloud") return backend;
  return resolved === "cloud" ? "cloud" : "local";
}

export function EngineSelector() {
  const t = useT();
  const queryClient = useQueryClient();
  const tab = useJevStore((s) => s.engineTab);
  const setTab = useJevStore((s) => s.setEngineTab);
  const status = useQuery({
    queryKey: ["systemone", "status"],
    queryFn: () => rpcClient.systemoneStatus(undefined),
    // 只在"正在装/正在下"时轮询：状态查询会起 worker 探缓存，空转不值得。
    refetchInterval: (query) => (isBusy(query.state.data) ? 1500 : false),
  });
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => rpcClient.getSettings(undefined) });
  const storedBackend = settings.data?.settings.SYSTEMONE_BACKEND ?? "";
  const resolved = status.data?.resolved ?? null;
  const [backendError, setBackendError] = useState<string | null>(null);
  // 首次拿到设置时决定停在哪个 tab（auto / 未设置 → 按当前解析结果落在实际会用的那侧）；
  // 之后不再跟着设置回写，免得后台刷新把用户刚点的 tab 拨回去。
  const decided = useRef(false);
  /*
   * tab 就是后端选择本身。
   *
   * 之前 tab 只是个"视图"，真正走哪条由 `SYSTEMONE_BACKEND`（默认 auto）决定 —— 于是
   * 用户在「云端接入」里填好 Key，请求仍然被 auto 的"本地优先"截走（本地服务地址一配，
   * 云端就永远轮不到）。用户看到的就是"我配了但它没调用我的后端"。
   * 现在切 tab 就写设置：本地运行 → local，云端接入 → cloud。
   */
  const pickBackend = useMutation({
    mutationFn: (patch: Record<string, string>) => rpcClient.updateSettings({ settings: patch }),
    onSuccess: () => {
      setBackendError(null);
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
      void queryClient.invalidateQueries({ queryKey: ["systemone", "status"] });
    },
    /*
     * 写失败必须把 tab 拨回去。
     *
     * 这一页的整个教训就是"界面说的后端"和"真正被调用的后端"会分家 —— 如果设置没写进去
     * 而 tab 停在云端，用户看到的就是同一个 bug 换了个样子（我选了云端、它还在走本地）。
     * 所以退回原选择并明说，而不是留一个乐观的假象。
     */
    onError: (error) => {
      setTab(tabForBackend(storedBackend, resolved));
      setBackendError(error instanceof Error ? error.message : String(error));
    },
  });
  useEffect(() => {
    if (decided.current || !storedBackend) return;
    decided.current = true;
    setTab(tabForBackend(storedBackend, resolved));
  }, [storedBackend, resolved, setTab]);
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-semibold text-muted-foreground">{t("jev.engine")}</span>
      <div className="flex gap-1 rounded-lg bg-muted p-1" role="tablist">
        {(["local", "cloud"] as EngineTab[]).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs transition-colors",
              tab === value ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => {
              setTab(value);
              // 只在真的变了的时候写，省一次设置写库 + 一轮状态重查。
              if (storedBackend !== BACKEND_FOR_TAB[value]) pickBackend.mutate({ SYSTEMONE_BACKEND: BACKEND_FOR_TAB[value] });
            }}
          >
            {value === "local" ? <CpuIcon className="size-3.5" aria-hidden /> : <CloudIcon className="size-3.5" aria-hidden />}
            {t(value === "local" ? "jev.engine.local" : "jev.engine.cloud")}
          </button>
        ))}
      </div>
      <p className="text-[11px] leading-4 text-muted-foreground">
        {t(tab === "local" ? "jev.engine.local.desc" : "jev.engine.cloud.desc")}
      </p>
      {backendError ? (
        <p className="jev-note error">{t("jev.backend.saveFailed", { message: backendError })}</p>
      ) : null}
      {tab === "local" ? <LocalPanel status={status.data} /> : <CloudPanel status={status.data} />}
    </div>
  );
}

function isBusy(status: SystemOneAvailability | undefined): boolean {
  if (!status) return false;
  return status.localRuntimePhase === "installing" || status.localRuntimePhase === "loading";
}

// ---------------------------------------------------------------------------
// 本地运行：引擎（laya-mlx）+ 三个权重
// ---------------------------------------------------------------------------

function LocalPanel({ status }: { status: SystemOneAvailability | undefined }) {
  const t = useT();
  const queryClient = useQueryClient();
  const installLog = useSystemOneInstallStore((s) => s.logs);
  // 一次订阅整张进度表，且**必须在下面两个提前 return 之前** ——
  // 钩子数量随 status 的有无而变会直接触发 React #310（"渲染的钩子比上次多"）。
  const progressMap = useSystemOneInstallStore((s) => s.progress);
  /*
   * 正在下哪个权重：只看 `download.isPending` 分不出来（三行共用一个 mutation），
   * 而推送可能在窗口刚起来时还没接上 —— 两条路都要能显示"下载中"。
   * 和其它钩子一样，必须在下面的提前 return **之前**（顺序一变就是 React #310）。
   */
  const [downloading, setDownloading] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["systemone", "status"] });

  const install = useMutation({ mutationFn: () => rpcClient.systemoneInstallRuntime(undefined), onSuccess: refresh });
  const uninstall = useMutation({ mutationFn: () => rpcClient.systemoneUninstallRuntime(undefined), onSuccess: refresh });
  const download = useMutation({
    mutationFn: (weights: string) => {
      setDownloading(weights);
      return rpcClient.systemoneDownloadModel({ weights });
    },
    // 成功/失败都要清掉：留着会让那一行一直显示"下载中"。
    onSettled: () => {
      setDownloading(null);
      refresh();
    },
  });
  const start = useMutation({
    mutationFn: (weights: string) => rpcClient.systemoneStartModel({ weights }),
    onSuccess: refresh,
  });
  const stop = useMutation({
    mutationFn: (weights: string) => rpcClient.systemoneStopModel({ weights }),
    onSuccess: refresh,
  });

  if (!status) {
    return (
      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Loader2Icon className="size-3 animate-spin" aria-hidden /> {t("jev.local.checking")}
      </p>
    );
  }

  if (!status.localRuntimeSupported) {
    return (
      <p className="jev-note error">
        <TriangleAlertIcon className="mr-1 inline size-3" aria-hidden />
        {t("systemone.runtime.unsupported")}
      </p>
    );
  }

  const busy = download.isPending || start.isPending || stop.isPending;
  const failure = download.data && !download.data.ok ? download.data.error : start.data && !start.data.ok ? start.data.error : null;

  return (
    <div className="flex flex-col gap-2">
      {/* 引擎本体 */}
      <div className="flex items-center gap-2 rounded-lg border p-2">
        <span className="min-w-0 flex-1 truncate text-[11px]">
          {status.localRuntimeInstalled ? (
            <>
              <CheckCircle2Icon className="mr-1 inline size-3 text-emerald-600" aria-hidden />
              {t("jev.local.engineReady", { version: status.localRuntimeVersion || "?" })}
            </>
          ) : (
            t("jev.local.engineMissing")
          )}
        </span>
        {status.localRuntimeInstalled ? (
          <Button size="sm" variant="outline" className="gap-1" disabled={uninstall.isPending} onClick={() => uninstall.mutate()}>
            <Trash2Icon className="size-3" aria-hidden />
            {t("systemone.runtime.uninstall")}
          </Button>
        ) : (
          <Button size="sm" className="gap-1" disabled={install.isPending} onClick={() => install.mutate()}>
            {install.isPending ? <Loader2Icon className="size-3 animate-spin" aria-hidden /> : <DownloadIcon className="size-3" aria-hidden />}
            {t("jev.local.installEngine")}
          </Button>
        )}
      </div>
      {status.localRuntimePhase === "installing" && status.localRuntimePhaseMessage ? (
        <p className="text-[11px] text-muted-foreground">
          <Loader2Icon className="mr-1 inline size-3 animate-spin" aria-hidden />
          {status.localRuntimePhaseMessage}
        </p>
      ) : null}
      {install.data && !install.data.ok ? <p className="jev-note error">{install.data.error}</p> : null}

      {/* 权重 */}
      {status.localRuntimeInstalled ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-medium">{t("jev.local.models")}</span>
          {status.localModels.map((model) => {
            const progress = progressMap[model.weights];
            // 推送与"点了下载、请求还没回来"两种来源合并成一个展示态。
            const downloadingThis = downloading === model.weights;
            const inFlight = downloadingThis || progress?.phase === "downloading";
            const bytes = Math.max(progress?.bytes ?? 0, downloadingThis ? model.bytes : 0);
            const percent = model.approxBytes > 0 ? Math.min(99, Math.round((bytes / model.approxBytes) * 100)) : null;
            return (
              <div key={model.name} className="flex items-center gap-2 rounded-lg border p-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-[11px] font-medium">{model.name}</span>
                  <span className="block truncate text-[10px] text-muted-foreground">
                    {model.loaded
                      ? t("jev.local.state.running")
                      : model.downloaded
                        ? t("jev.local.state.downloaded", { size: formatBytes(model.bytes) })
                        : inFlight
                          ? percent === null
                            ? t("jev.local.state.downloading", { size: formatBytes(bytes) })
                            : t("jev.local.state.downloadingPct", {
                                percent: String(percent),
                                size: formatBytes(bytes),
                                total: formatBytes(model.approxBytes),
                              })
                          : t("jev.local.state.missing")}
                  </span>
                  {inFlight ? (
                    // 进度条：宽度按百分比；没有分母时走"不确定"动画（条纹滚动），
                    // 总之要让用户看到"在动"，而不是一个静止的按钮。
                    <span className="jev-prob-track mt-1 block w-full">
                      <span
                        className={cn("jev-prob-fill block", percent === null && "animate-pulse")}
                        style={{ width: percent === null ? "100%" : `${percent}%` }}
                      />
                    </span>
                  ) : null}
                </span>
                {model.loaded ? (
                  <Button size="sm" variant="outline" className="gap-1" disabled={busy} onClick={() => stop.mutate(model.weights)}>
                    <SquareIcon className="size-3" aria-hidden />
                    {t("jev.local.stop")}
                  </Button>
                ) : model.downloaded ? (
                  <Button size="sm" className="gap-1" disabled={busy} onClick={() => start.mutate(model.weights)}>
                    {start.isPending ? <Loader2Icon className="size-3 animate-spin" aria-hidden /> : <PlayIcon className="size-3" aria-hidden />}
                    {t("jev.local.start")}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1"
                    // 按钮状态跟着**同一个**判据（inFlight），否则会出现"行里写着下载中、
                    // 按钮还写着下载"这种自相矛盾的画面（推送到了、但点的人不是这一处）。
                    disabled={busy || inFlight}
                    onClick={() => download.mutate(model.weights)}
                  >
                    {inFlight ? (
                      <Loader2Icon className="size-3 animate-spin" aria-hidden />
                    ) : (
                      <DownloadIcon className="size-3" aria-hidden />
                    )}
                    {inFlight ? t("jev.local.downloading") : t("jev.local.download")}
                  </Button>
                )}
              </div>
            );
          })}
          <p className="text-[10px] leading-4 text-muted-foreground">{t("jev.local.hint")}</p>
        </div>
      ) : null}

      {failure ? <p className="jev-note error">{failure}</p> : null}
      {installLog.length > 0 && !status.localRuntimeInstalled ? (
        <pre className="jev-log max-h-28">{installLog.slice(-8).join("\n")}</pre>
      ) : null}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (!bytes) return "0 MB";
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
}

// ---------------------------------------------------------------------------
// 云端接入：Base URL + Key + 模型
// ---------------------------------------------------------------------------

function CloudPanel({ status }: { status: SystemOneAvailability | undefined }) {
  const t = useT();
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => rpcClient.getSettings(undefined) });
  const [base, setBase] = useState("");
  const [key, setKey] = useState("");
  const [model, setModel] = useState("");
  const [touched, setTouched] = useState(false);

  const savedBase = settings.data?.settings.SYSTEMONE_CLOUD_BASE_URL ?? "";
  const savedModel = settings.data?.settings.SYSTEMONE_CLOUD_MODEL ?? "";
  // 首次读到设置回填一次；之后以用户输入为准（否则每次刷新设置都会覆盖正在输入的框）。
  useEffect(() => {
    if (touched) return;
    if (savedBase) setBase((prev) => prev || savedBase);
    if (savedModel) setModel((prev) => prev || savedModel);
  }, [savedBase, savedModel, touched]);

  const save = useMutation({
    mutationFn: (patch: Record<string, string>) => rpcClient.updateSettings({ settings: patch }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
      void queryClient.invalidateQueries({ queryKey: ["systemone", "status"] });
    },
  });
  const test = useMutation({ mutationFn: () => rpcClient.systemoneTest(undefined) });

  const inputClass = "h-8 text-xs";

  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-muted-foreground">{t("systemone.field.cloudBase")}</span>
        <Input
          className={inputClass}
          value={base}
          placeholder="https://api.typesafe.ai"
          spellCheck={false}
          onChange={(event) => {
            setTouched(true);
            setBase(event.target.value);
          }}
          onBlur={() => save.mutate({ SYSTEMONE_CLOUD_BASE_URL: base.trim() })}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-muted-foreground">{t("systemone.field.cloudKey")}</span>
        <Input
          className={inputClass}
          type="password"
          value={key}
          placeholder={status?.cloudConfigured ? "••••••••" : "sk-…"}
          spellCheck={false}
          onChange={(event) => {
            setTouched(true);
            setKey(event.target.value);
          }}
          onBlur={() => {
            if (!key.trim()) return;
            save.mutate({ SYSTEMONE_CLOUD_API_KEY: key.trim() });
            setKey("");
          }}
        />
        <span className="text-[10px] text-muted-foreground">
          {status?.cloudConfigured ? t("systemone.field.cloudKeySet") : t("systemone.field.cloudKeyHint")}
        </span>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-muted-foreground">{t("jev.cloud.model")}</span>
        <Input
          className={inputClass}
          value={model}
          placeholder="jev-latest"
          spellCheck={false}
          onChange={(event) => {
            setTouched(true);
            setModel(event.target.value);
          }}
          onBlur={() => save.mutate({ SYSTEMONE_CLOUD_MODEL: model.trim() || "jev-latest" })}
        />
      </label>
      <Button size="sm" variant="outline" className="gap-1 self-start" disabled={test.isPending} onClick={() => test.mutate()}>
        {test.isPending ? <Loader2Icon className="size-3 animate-spin" aria-hidden /> : null}
        {t("systemone.test")}
      </Button>
      {test.data && !test.data.ok ? <p className="jev-note error">{t("systemone.test.failed", { message: test.data.message })}</p> : null}
      {test.data?.ok ? (
        <p className="jev-note ok">
          {t("systemone.test.ok", {
            model: test.data.model,
            backend: t(`systemone.backend.${test.data.backend}`),
            ms: String(test.data.latencyMs),
            noul: test.data.noul.toFixed(3),
          })}
        </p>
      ) : null}
    </div>
  );
}
