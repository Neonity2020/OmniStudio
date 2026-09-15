// 新建知识库弹窗（侧栏「新建」与主页空状态共用，开关在 kb store）。
// 嵌入/重排模型可创建时就选（默认「不使用」），候选来自本地推理服务与云端配置。
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2Icon, PlusIcon } from "lucide-react";

import { rpcClient } from "@lib/rpc";
import { Button } from "@ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@ui/dialog";
import { Input } from "@ui/input";
import { Label } from "@ui/label";
import { Textarea } from "@ui/textarea";
import { useKbStore } from "@stores/kb";
import { useT } from "@stores/ui-lang";
import { KbModelSelect, useKbModelCandidates } from "./model-select";

export function KbCreateDialog() {
  const t = useT();
  const queryClient = useQueryClient();
  const open = useKbStore((s) => s.createOpen);
  const setOpen = useKbStore((s) => s.setCreateOpen);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [embeddingModel, setEmbeddingModel] = useState("");
  const [rerankModel, setRerankModel] = useState("");

  // 弹窗打开时才拉模型候选（本地推理服务的 /v1/models + 设置里的云端模型）。
  const embedCandidates = useKbModelCandidates("embedding", "", "", open);
  const rerankCandidates = useKbModelCandidates("rerank", "", "", open);

  const createMutation = useMutation({
    mutationFn: () =>
      rpcClient.kbCreate({
        name,
        description,
        embeddingModel: embeddingModel || undefined,
        rerankModel: rerankModel || undefined,
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["kb-list"] });
      useKbStore.getState().setSelectedKbId(data.kb.id);
      setOpen(false);
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setOpen(false);
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("kb.create.title")}</DialogTitle>
          <DialogDescription>{t("kb.create.desc")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-1">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="kb-name">{t("kb.create.name")}</Label>
            <Input
              id="kb-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("kb.create.namePlaceholder")}
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="kb-desc">{t("kb.create.descLabel")}</Label>
            <Textarea
              id="kb-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("kb.create.descPlaceholder")}
              rows={2}
              className="resize-none"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="kb-embed-select">{t("kb.create.embedding")}</Label>
            <KbModelSelect
              id="kb-embed-select"
              value={embeddingModel}
              onChange={setEmbeddingModel}
              candidates={embedCandidates.data}
              loading={embedCandidates.isLoading}
            />
            <p className="text-[10px] leading-4 text-muted-foreground/80">
              {t("kb.create.embeddingHint")}
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="kb-rerank-select">{t("kb.create.rerank")}</Label>
            <KbModelSelect
              id="kb-rerank-select"
              value={rerankModel}
              onChange={setRerankModel}
              candidates={rerankCandidates.data}
              loading={rerankCandidates.isLoading}
            />
            <p className="text-[10px] leading-4 text-muted-foreground/80">
              {t("kb.create.rerankHint")}
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            size="sm"
            disabled={!name.trim() || createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            {createMutation.isPending ? (
              <Loader2Icon className="size-3.5 animate-spin" />
            ) : (
              <PlusIcon className="size-3.5" />
            )}
            {t("kb.create.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
