/**
 * SystemOne（JEV）契约 —— 与 TypeSafe 官方 API 逐字段对齐。
 *
 * 这个文件是**唯一**的协议来源：网关（`bun/gateway.ts` 的 `/v1/systemone`）、
 * 本地/云端后端（`bun/systemone.ts`）、Agent 工具与界面都从这里取类型与校验。
 *
 * 对齐依据（都对 [api.typesafe.ai](https://api.typesafe.ai/openapi.json) 实测过）：
 * - `POST /v1/systemone` 请求体 `{ state, model, questions }`，`questions` 是
 *   `{ 名字: { type, instructions?, criteria } }`，`type` 为 `noul` / `choice` / `score`；
 * - 响应 `{ model, answers, usage: { input_tokens, output_tokens } }`，每个 answer 的
 *   `type` 与对应问题一致；
 * - `GET /v1/models` 返回 `{ models: [{ name, description, release_date }] }`；
 * - 鉴权失败时**缺 Key 返回 403、Key 无效返回 401**，body 都是
 *   `{ detail: { error_type: "authentication_error", message } }`（HTTPBearer 的两种失败）；
 * - 校验失败 422，body 是 FastAPI 形状 `{ detail: [{ loc, msg, type, input, ctx }] }`；
 * - 成功响应带 `x-typesafe-request-id` 头。
 *
 * 目标：官方 SDK（`typesafe-sdk` / `@typesafe-ai/sdk`）只改 `TYPESAFE_BASE_URL` 与
 * `TYPESAFE_API_KEY` 就能打到我们这里，"效果一模一样"。
 */

/** `state` / `instructions` / `criteria` 的取值：字符串、JSON 对象、数组，或 `null`。 */
export type SystemOneEntry = string | Record<string, unknown> | readonly unknown[] | null;

export type SystemOneQuestionType = "noul" | "choice" | "score";

/** yes/no 问题（返回 P(true)）。`criteria` 可选，描述什么算 yes / no。 */
export type SystemOneNoulQuestion = {
  type: "noul";
  instructions?: SystemOneEntry;
  criteria?: { true?: SystemOneEntry; false?: SystemOneEntry } | null;
};

/** 单选问题：`criteria` 是「选项名 → 说明」的映射（必填）。 */
export type SystemOneChoiceQuestion = {
  type: "choice";
  instructions?: SystemOneEntry;
  criteria: Record<string, SystemOneEntry>;
};

/** 打分问题：`criteria` 是**有序**档位描述（必填），档位号 = 数组下标（从 0 起）。 */
export type SystemOneScoreQuestion = {
  type: "score";
  instructions?: SystemOneEntry;
  criteria: SystemOneEntry[];
};

export type SystemOneQuestion = SystemOneNoulQuestion | SystemOneChoiceQuestion | SystemOneScoreQuestion;

/** 问题集合：键是用户自己起的名字，会原样出现在响应的 `answers` 里。 */
export type SystemOneQuestions = Record<string, SystemOneQuestion>;

export type SystemOneNoulAnswer = { type: "noul"; noul: number };

export type SystemOneChoiceAnswer = {
  type: "choice";
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
};

export type SystemOneScoreAnswer = {
  type: "score";
  score: number;
  confidence: number;
  legend: Record<string, SystemOneEntry>;
  probabilities: Record<string, number>;
};

export type SystemOneAnswer = SystemOneNoulAnswer | SystemOneChoiceAnswer | SystemOneScoreAnswer;
export type SystemOneAnswers = Record<string, SystemOneAnswer>;

export type SystemOneUsage = {
  /** 计费的输入 tokens（问题 + state 的编码长度）。 */
  input_tokens: number;
  /** 输出 tokens：当前免费（本地模型恒为 0，不逐 token 解码）。 */
  output_tokens: number;
};

export type SystemOneRequest = {
  state: Exclude<SystemOneEntry, null>;
  model: string;
  questions: SystemOneQuestions;
};

export type SystemOneResponse = {
  model: string;
  answers: SystemOneAnswers;
  usage: SystemOneUsage;
};

/** `/v1/models` 里一张模型卡片，字段与官方 `ModelMetadata` 一致。 */
export type SystemOneModelCard = {
  name: string;
  description: string;
  release_date: string;
};

/** 我们自己用的模型条目：卡片 + 后端归属 + 价格（价格只在应用内展示，不进网关响应）。 */
export type SystemOneModel = SystemOneModelCard & {
  /** 解析后的具体版本（别名会指向它），会出现在响应的 `model` 字段里。 */
  version: string;
  backend: "cloud" | "local";
  /** 本地模型的权重 repo（laya-mlx 通过它加载）；云端为空。 */
  weights?: string;
  /**
   * 权重的**约**体积（fp16 = 参数量 × 2 字节 + tokenizer/config）。
   *
   * 只用来给下载进度一个分母 —— 真实大小以 Hugging Face 上那份为准（可能随 revision
   * 变化），所以界面上写「约」而不是精确值。没有它，下载中只能显示一个不断变大的
   * 字节数，用户无法判断是"刚开始"还是"快完了"。
   */
  approxBytes?: number;
};

/** 官方给旗舰模型起的别名 → 版本。`jev-preview` 目前与 latest 同指。 */
export const SYSTEMONE_MODEL_ALIASES: Record<string, string> = {
  "jev-latest": "jev-1.13.0",
  "jev-preview": "jev-1.13.0",
};

export const SYSTEMONE_DEFAULT_MODEL = "jev-latest";

/**
 * 云端的 JEV 模型（TypeSafe 官方服务）。
 *
 * `release_date` 与官方 Models 文档一致；`description` 保留官方口径。
 */
const CLOUD_MODELS: SystemOneModel[] = [
  {
    name: "jev-1.13.0",
    version: "jev-1.13.0",
    backend: "cloud",
    release_date: "2026-09-15",
    description: "TypeSafe JEV 1.13 (System One) — typed decisions, text only, 64k context.",
  },
  {
    name: "jev-latest",
    version: "jev-1.13.0",
    backend: "cloud",
    release_date: "2026-09-15",
    description: "Alias for the most recent stable JEV release.",
  },
  {
    name: "jev-preview",
    version: "jev-1.13.0",
    backend: "cloud",
    release_date: "2026-09-15",
    description: "Alias for the most recent JEV release, official or not.",
  },
];

/**
 * 本地 JEV 模型（laya-mlx 在 Apple Silicon 上跑的开放权重权重）。
 *
 * 三个 checkpoint 与 laya-mlx 的 "Supported checkpoints" 表一一对应：
 * 英文 / 多语言 / typed-decisions 工作流。走本地后端时 `model` 传这些名字。
 */
const LOCAL_MODELS: SystemOneModel[] = [
  {
    name: "laya-latest",
    version: "laya-1",
    backend: "local",
    weights: "aac6fef/laya-mlx",
    approxBytes: 850_000_000,
    release_date: "2026-09-01",
    description: "Laya (English, ModernBERT-large 421M) via MLX — local, offline, 0 output tokens.",
  },
  {
    name: "laya-multilingual",
    version: "laya-multilingual-1",
    backend: "local",
    weights: "aac6fef/laya-multilingual-mlx",
    approxBytes: 650_000_000,
    release_date: "2026-09-01",
    description: "Laya Multilingual (mmBERT-base 322M) via MLX — local, best for non-English state.",
  },
  {
    name: "laya-typed-decisions",
    version: "laya-typed-decisions-1",
    backend: "local",
    weights: "aac6fef/laya-typed-decisions-mlx",
    approxBytes: 850_000_000,
    release_date: "2026-09-01",
    description: "Laya typed-decisions (ModernBERT-large 421M) via MLX — upstream workflow parity.",
  },
];

export const SYSTEMONE_MODELS: readonly SystemOneModel[] = [...CLOUD_MODELS, ...LOCAL_MODELS];

export const SYSTEMONE_LOCAL_MODEL_NAMES: readonly string[] = LOCAL_MODELS.map((m) => m.name);

/**
 * 价格：**一律 0**。JEV 在 OmniStudio 里免费 —— 云端走的是用户自己的 Key（我们不转售），
 * 本地是用户自己的机器。这里保留价格字段是为了界面能如实显示「免费」，以及以后真有
 * 计费时可以只改这一处。
 */
export const SYSTEMONE_PRICING = { inputPerMTok: 0, outputPerMTok: 0 } as const;

/** 按名字（含别名、版本号）找模型；找不到返回 `null`。 */
export function findSystemOneModel(name: string): SystemOneModel | null {
  const wanted = (name ?? "").trim();
  if (!wanted) return null;
  const direct = SYSTEMONE_MODELS.find((m) => m.name === wanted);
  if (direct) return direct;
  const resolved = SYSTEMONE_MODEL_ALIASES[wanted];
  return resolved ? (SYSTEMONE_MODELS.find((m) => m.name === resolved) ?? null) : null;
}

/** 请求里的 `model` 归一化成官方 `ModelMetadataList` 卡片（只含官方那三个字段）。 */
export function systemOneModelCards(): SystemOneModelCard[] {
  return SYSTEMONE_MODELS.map(({ name, description, release_date }) => ({ name, description, release_date }));
}

// ---------------------------------------------------------------------------
// 校验（产出 FastAPI 形状的 422 detail）
// ---------------------------------------------------------------------------

/** 一条校验错误，字段与 FastAPI / pydantic v2 的 `ValidationError` 一致。 */
export type SystemOneValidationError = {
  loc: (string | number)[];
  msg: string;
  type: string;
  input?: unknown;
  ctx?: Record<string, unknown>;
};

export type SystemOneValidationResult =
  | { ok: true; value: SystemOneRequest }
  | { ok: false; errors: SystemOneValidationError[] };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEntry(value: unknown): value is SystemOneEntry {
  return value === null || typeof value === "string" || isPlainObject(value) || Array.isArray(value);
}

function err(loc: (string | number)[], msg: string, type: string, input?: unknown, ctx?: Record<string, unknown>) {
  return { loc, msg, type, ...(input === undefined ? {} : { input }), ...(ctx === undefined ? {} : { ctx }) };
}

function validateQuestion(name: string, raw: unknown): SystemOneValidationError[] {
  const loc = ["body", "questions", name];
  if (!isPlainObject(raw)) {
    return [err(loc, "Input should be a valid dictionary or object to extract fields from", "model_attributes_type", raw)];
  }
  const type = raw.type;
  if (typeof type !== "string" || !type) {
    return [err([...loc, "type"], "Field required", "missing", raw)];
  }
  if (type !== "noul" && type !== "choice" && type !== "score") {
    return [
      err([...loc, "type"], "Input should be 'noul', 'choice' or 'score'", "literal_error", type, {
        expected: "'noul', 'choice' or 'score'",
      }),
    ];
  }

  const out: SystemOneValidationError[] = [];
  if ("instructions" in raw && !isEntry(raw.instructions)) {
    out.push(
      err(
        [...loc, "instructions"],
        "Input should be a valid string, object, array or null",
        "model_attributes_type",
        raw.instructions,
      ),
    );
  }

  const criteria = raw.criteria;
  if (type === "score") {
    if (criteria === undefined) {
      out.push(err([...loc, "criteria"], "Field required", "missing", undefined));
    } else if (!Array.isArray(criteria)) {
      out.push(err([...loc, "criteria"], "Input should be a valid list", "list_type", criteria));
    } else if (criteria.length < 1) {
      out.push(err([...loc, "criteria"], "List should have at least 1 item after validation, not 0", "too_short", criteria, { min_length: 1 }));
    } else if (criteria.some((c) => !isEntry(c))) {
      out.push(err([...loc, "criteria"], "Every score level must be a string, object or array", "model_attributes_type", criteria));
    }
  } else if (type === "choice") {
    if (criteria === undefined) {
      out.push(err([...loc, "criteria"], "Field required", "missing", undefined));
    } else if (!isPlainObject(criteria)) {
      out.push(err([...loc, "criteria"], "Input should be a valid dictionary or object to extract fields from", "model_attributes_type", criteria));
    } else if (Object.keys(criteria).length < 1) {
      out.push(err([...loc, "criteria"], "Dictionary should have at least 1 item after validation, not 0", "too_short", criteria, { min_length: 1 }));
    } else if (Object.values(criteria).some((c) => !isEntry(c))) {
      out.push(err([...loc, "criteria"], "Every choice description must be a string, object, array or null", "model_attributes_type", criteria));
    }
  } else if (criteria !== undefined && criteria !== null) {
    // noul：criteria 可选，给了就必须是 { true?, false? }。
    if (!isPlainObject(criteria)) {
      out.push(err([...loc, "criteria"], "Input should be a valid dictionary or object to extract fields from", "model_attributes_type", criteria));
    } else {
      for (const key of ["true", "false"] as const) {
        if (key in criteria && !isEntry(criteria[key])) {
          out.push(err([...loc, "criteria", key], "Input should be a valid string, object, array or null", "model_attributes_type", criteria[key]));
        }
      }
    }
  }
  return out;
}

/**
 * 校验一个 `POST /v1/systemone` 请求体。
 *
 * 只做官方 OpenAPI 里声明过的约束（`minProperties: 1`、`minItems: 1`、必填字段、
 * 类型与字面量）。**刻意不额外加限制** —— 官方 SDK 在客户端已经拦掉的东西
 * （例如 score 至少两档）在这里放行，避免我们把官方能过的请求拒掉。
 */
export function validateSystemOneRequest(raw: unknown): SystemOneValidationResult {
  if (!isPlainObject(raw)) {
    return {
      ok: false,
      errors: [err(["body"], "Input should be a valid dictionary or object to extract fields from", "model_attributes_type", raw)],
    };
  }
  const errors: SystemOneValidationError[] = [];

  const state = raw.state;
  if (state === undefined) {
    errors.push(err(["body", "state"], "Field required", "missing", undefined));
  } else if (!(typeof state === "string" || isPlainObject(state) || Array.isArray(state))) {
    errors.push(err(["body", "state"], "Input should be a valid string, object or array", "model_attributes_type", state));
  }

  const model = raw.model;
  if (model === undefined) {
    errors.push(err(["body", "model"], "Field required", "missing", undefined));
  } else if (typeof model !== "string") {
    errors.push(err(["body", "model"], "Input should be a valid string", "string_type", model));
  } else if (!model.trim()) {
    errors.push(err(["body", "model"], "String should have at least 1 character", "string_too_short", model, { min_length: 1 }));
  }

  const questions = raw.questions;
  if (questions === undefined) {
    errors.push(err(["body", "questions"], "Field required", "missing", undefined));
  } else if (!isPlainObject(questions)) {
    errors.push(err(["body", "questions"], "Input should be a valid dictionary or object to extract fields from", "model_attributes_type", questions));
  } else if (Object.keys(questions).length < 1) {
    errors.push(err(["body", "questions"], "Dictionary should have at least 1 item after validation, not 0", "too_short", questions, { min_length: 1 }));
  } else {
    for (const [name, question] of Object.entries(questions)) errors.push(...validateQuestion(name, question));
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      state: state as SystemOneRequest["state"],
      model: (model as string).trim(),
      questions: questions as SystemOneQuestions,
    },
  };
}

// ---------------------------------------------------------------------------
// 错误体 / 请求 id（与官方逐字段一致）
// ---------------------------------------------------------------------------

export type SystemOneErrorBody = {
  detail: { error_type: string; message: string };
};

/**
 * 鉴权失败的两条文案，与官方一致：
 * - 请求里**根本没有** Authorization 头 → 403 `Must supply an API key!`
 * - 有 Key 但**校验不过** → 401 `Cannot authenticate with the server.`
 */
export const SYSTEMONE_AUTH_MESSAGES = {
  missing: "Must supply an API key! Check your request and try again.",
  invalid: "Cannot authenticate with the server. Please check your API key and try again.",
} as const;

export function systemOneAuthErrorBody(kind: "missing" | "invalid"): SystemOneErrorBody {
  return { detail: { error_type: "authentication_error", message: SYSTEMONE_AUTH_MESSAGES[kind] } };
}

/** 校验失败的 422 body。 */
export function systemOneValidationBody(errors: SystemOneValidationError[]) {
  return { detail: errors };
}

/** 官方请求 id 的形状：`req_` + 32 位 hex。两个进程都能用（Bun 与浏览器都有 WebCrypto）。 */
export function newSystemOneRequestId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return `req_${hex}`;
}
