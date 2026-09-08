"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Boxes,
  ChevronLeft,
  ChevronRight,
  Clock3,
  PackageCheck,
  RefreshCw,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type RecordRow = {
  src: "bd" | "backlog";
  o: string;
  p: string;
  t: string;
  w: string;
  d: string;
  dt: string;
  sc: string;
  s: string;
  u: boolean;
  x: boolean;
  ch: string;
  q: number;
  l: string;
};

type Payload = {
  updatedAt: string;
  bd: RecordRow[];
  backlog: RecordRow[];
};

type Dimension = "orders" | "items";
type Dataset = "bd" | "backlog";
type DetailFilter =
  | { kind: "all"; label: string }
  | { kind: "status"; value: string; label: string }
  | { kind: "oos"; label: string }
  | { kind: "stale"; label: string };

const STATUS_ORDER = [
  "Created",
  "Pending Pick",
  "Picking",
  "Picked",
  "Pick Fail",
  "Sorting",
  "Sorted",
  "Checking",
  "Checked",
  "Packing",
  "Packed",
  "Shipping",
  "Outbound",
];

const STATUS_COLORS: Record<string, string> = {
  Created: "#f97316",
  "Pending Pick": "#f59e0b",
  Picking: "#eab308",
  Picked: "#2563eb",
  "Pick Fail": "#ef4444",
  Sorting: "#0ea5e9",
  Sorted: "#06b6d4",
  Checking: "#14b8a6",
  Checked: "#10b981",
  Packing: "#8b5cf6",
  Packed: "#7c3aed",
  Shipping: "#a855f7",
  Outbound: "#9333ea",
};

const number = new Intl.NumberFormat("pt-BR");

function metric(rows: RecordRow[], dimension: Dimension) {
  if (dimension === "items") {
    return rows.reduce((sum, row) => sum + row.q, 0);
  }
  return new Set(rows.map((row) => row.o)).size;
}

function parseDate(value: string) {
  if (!value) return null;
  const normalized = value.replace(" America/Sao_Paulo", "").replace(" ", "T");
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDate(value: string) {
  if (!value) return "—";
  const parts = value.slice(0, 10).split("-");
  return parts.length === 3 ? parts[2] + "/" + parts[1] + "/" + parts[0] : value;
}

function statusIndex(status: string) {
  const index = STATUS_ORDER.indexOf(status);
  return index < 0 ? 0 : index;
}

export default function Home() {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [dataset, setDataset] = useState<Dataset>("bd");
  const [dimension, setDimension] = useState<Dimension>("orders");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [detail, setDetail] = useState<DetailFilter | null>(null);
  const [detailSearch, setDetailSearch] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    let active = true;

    const loadData = async () => {
      const base = import.meta.env.BASE_URL;
      const refreshKey = Date.now();
      const manifestResponse = await fetch(`${base}data-parts/manifest.json?v=${refreshKey}`, {
        cache: "no-store",
      });
      if (!manifestResponse.ok) throw new Error(`Falha ao carregar índice (${manifestResponse.status})`);
      const manifest = (await manifestResponse.json()) as { parts: number };
      const requests = Array.from({ length: manifest.parts }, (_, index) => {
        const part = String(index).padStart(3, "0");
        return fetch(`${base}data-parts/part-${part}?v=${refreshKey}`, { cache: "no-store" }).then((response) => {
          if (!response.ok) throw new Error(`Falha ao carregar dados (${response.status})`);
          return response.arrayBuffer();
        });
      });
      const parts = await Promise.all(requests);
      const compressed = new Blob(parts).stream();
      const decompressed = compressed.pipeThrough(new DecompressionStream("gzip"));
      const data = (await new Response(decompressed).json()) as Payload;
      if (active) setPayload(data);
    };

    loadData().catch((error) => console.error("Não foi possível carregar o dashboard.", error));
    const refreshTimer = window.setInterval(() => {
      loadData().catch((error) => console.error("Não foi possível atualizar o dashboard.", error));
    }, 5 * 60 * 1000);

    return () => {
      active = false;
      window.clearInterval(refreshTimer);
    };
  }, []);

  const sourceRows = useMemo(
    () => (dataset === "bd" ? payload?.bd ?? [] : payload?.backlog ?? []),
    [dataset, payload],
  );

  const filtered = useMemo(
    () =>
      sourceRows.filter((row) => {
        if (dateFrom && row.d < dateFrom) return false;
        if (dateTo && row.d > dateTo) return false;
        return true;
      }),
    [sourceRows, dateFrom, dateTo],
  );

  const statusGroups = useMemo(() => {
    const groups = new Map<string, RecordRow[]>();
    filtered.forEach((row) => {
      const bucket = groups.get(row.s) ?? [];
      bucket.push(row);
      groups.set(row.s, bucket);
    });
    return Array.from(groups.entries()).sort(
      ([a], [b]) => STATUS_ORDER.indexOf(a) - STATUS_ORDER.indexOf(b),
    );
  }, [filtered]);

  const lastReference = useMemo(() => {
    const times = sourceRows
      .map((row) => parseDate(row.l)?.getTime() ?? 0)
      .filter(Boolean);
    return times.length ? Math.max(...times) : Date.now();
  }, [sourceRows]);

  const staleRows = useMemo(
    () =>
      filtered.filter((row) => {
        const latest = parseDate(row.l);
        return latest ? lastReference - latest.getTime() >= 4 * 60 * 60 * 1000 : false;
      }),
    [filtered, lastReference],
  );

  const oosRows = useMemo(() => filtered.filter((row) => row.x), [filtered]);

  const chartData = useMemo(() => {
    const byDate = new Map<string, Record<string, number | string>>();
    filtered.forEach((row) => {
      const item = byDate.get(row.d) ?? { date: formatDate(row.d) };
      item[row.s] = Number(item[row.s] ?? 0) + (dimension === "items" ? row.q : 1);
      byDate.set(row.d, item);
    });
    return Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, value]) => {
        const total = Object.entries(value).reduce(
          (sum, [key, item]) => key === "date" ? sum : sum + Number(item),
          0,
        );
        const withShares = { ...value };
        statusGroups.forEach(([status]) => {
          withShares[status + "Share"] = total
            ? (Number(value[status] ?? 0) * 100) / total
            : 0;
        });
        return withShares;
      });
  }, [filtered, dimension, statusGroups]);

  const progressRows = useMemo(() => {
    if (!payload) return [];
    const base = payload.bd.filter((row) => {
      if (dateFrom && row.d < dateFrom) return false;
      if (dateTo && row.d > dateTo) return false;
      return true;
    });
    const total = metric(base, dimension);
    const completed = (stage: string, inclusive: boolean) => {
      const threshold = statusIndex(stage);
      return metric(
        base.filter((row) =>
          inclusive ? statusIndex(row.s) >= threshold : statusIndex(row.s) > threshold,
        ),
        dimension,
      );
    };
    const percent = (value: number) => (total ? (value * 100) / total : 0);
    return [
      { label: "OOS", value: percent(metric(base.filter((row) => row.x), dimension)), color: "red" },
      { label: "Created", value: percent(completed("Created", false)), color: "orange" },
      { label: "Picked", value: percent(completed("Picked", true)), color: "blue" },
      { label: "Checked", value: percent(completed("Checked", true)), color: "green" },
      { label: "Outbound", value: percent(completed("Outbound", true)), color: "purple" },
    ];
  }, [payload, dimension, dateFrom, dateTo]);

  const detailRows = useMemo(() => {
    if (!detail) return [];
    let rows = filtered;
    if (detail.kind === "status") rows = rows.filter((row) => row.s === detail.value);
    if (detail.kind === "oos") rows = rows.filter((row) => row.x);
    if (detail.kind === "stale") rows = staleRows;
    const query = detailSearch.trim().toLowerCase();
    if (query) {
      rows = rows.filter((row) =>
        [row.o, row.p, row.t, row.s].some((value) => value.toLowerCase().includes(query)),
      );
    }
    return rows;
  }, [detail, filtered, staleRows, detailSearch]);

  const pageSize = 50;
  const pages = Math.max(1, Math.ceil(detailRows.length / pageSize));
  const visibleDetails = detailRows.slice((page - 1) * pageSize, page * pageSize);

  function openDetail(next: DetailFilter) {
    setDetail(next);
    setDetailSearch("");
    setPage(1);
  }

  function resetFilters() {
    setDateFrom("");
    setDateTo("");
  }

  if (!payload) {
    return (
      <main className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto max-w-[1600px] space-y-5">
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-20 rounded-2xl" />
          <div className="grid gap-4 md:grid-cols-4">
            {Array.from({ length: 8 }).map((_, index) => (
              <Skeleton className="h-28 rounded-2xl" key={index} />
            ))}
          </div>
        </div>
      </main>
    );
  }

  const updated = new Date(payload.updatedAt).toLocaleString("pt-BR");
  const totalLabel = dimension === "orders" ? "ordens" : "itens";

  return (
    <main className="min-h-screen bg-[#f4f7fb] text-slate-950">
      <header className="border-b border-slate-800 bg-[#101c33] text-white">
        <div className="mx-auto flex max-w-[1600px] flex-col gap-4 px-5 py-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-orange-400">
              <span className="h-2 w-2 rounded-full bg-orange-500" />
              Control tower
            </div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Dashboard Operacional COT</h1>
          </div>
          <div className="flex items-center gap-2 text-sm text-slate-300">
            <RefreshCw className="h-4 w-4" />
            Base atualizada em {updated}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1600px] space-y-5 p-4 sm:p-5">
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-end gap-3">
            <div className="mr-2 flex rounded-xl bg-slate-100 p-1">
              <Button
                variant={dataset === "bd" ? "default" : "ghost"}
                className={dataset === "bd" ? "bg-[#172b4d] hover:bg-[#172b4d]" : ""}
                onClick={() => setDataset("bd")}
              >
                COT ativo
              </Button>
              <Button
                variant={dataset === "backlog" ? "default" : "ghost"}
                className={dataset === "backlog" ? "bg-red-600 hover:bg-red-600" : ""}
                onClick={() => setDataset("backlog")}
              >
                Backlog
              </Button>
            </div>

            <label className="space-y-1 text-sm font-medium text-slate-600">
              <span>Dimensão</span>
              <Select value={dimension} onValueChange={(value) => setDimension(value as Dimension)}>
                <SelectTrigger className="w-36 bg-white"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="orders">Ordens</SelectItem>
                  <SelectItem value="items">Itens</SelectItem>
                </SelectContent>
              </Select>
            </label>

            <label className="space-y-1 text-sm font-medium text-slate-600">
              <span>COT inicial</span>
              <Input type="date" className="w-40" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
            </label>
            <label className="space-y-1 text-sm font-medium text-slate-600">
              <span>COT final</span>
              <Input type="date" className="w-40" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
            </label>

            <Button variant="ghost" onClick={resetFilters}>
              <SlidersHorizontal className="mr-2 h-4 w-4" /> Limpar
            </Button>
          </div>
        </section>

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label={dataset === "bd" ? "Total no COT" : "Backlog"}
            value={metric(filtered, dimension)}
            note={totalLabel}
            icon={<Boxes className="h-5 w-5" />}
            accent={dataset === "bd" ? "navy" : "red"}
            onClick={() => openDetail({ kind: "all", label: dataset === "bd" ? "Todas as ordens do COT" : "Todas as ordens do backlog" })}
          />
          <MetricCard
            label="OOS"
            value={metric(oosRows, dimension)}
            note={totalLabel}
            icon={<AlertTriangle className="h-5 w-5" />}
            accent="red"
            onClick={() => openDetail({ kind: "oos", label: "Ordens OOS" })}
          />
          <MetricCard
            label="Sem movimentação"
            value={metric(staleRows, dimension)}
            note="há mais de 4h"
            icon={<Clock3 className="h-5 w-5" />}
            accent="amber"
            onClick={() => openDetail({ kind: "stale", label: "Ordens sem movimentação há mais de 4h" })}
          />
          <MetricCard
            label="Outbound"
            value={metric(filtered.filter((row) => row.s === "Outbound"), dimension)}
            note={totalLabel}
            icon={<PackageCheck className="h-5 w-5" />}
            accent="purple"
            onClick={() => openDetail({ kind: "status", value: "Outbound", label: "Ordens em Outbound" })}
          />
        </section>

        <section>
          <div className="mb-3 flex items-end justify-between">
            <div>
              <h2 className="text-lg font-bold">Visão por status</h2>
              <p className="text-sm text-slate-500">Clique em um card para abrir as ordens correspondentes.</p>
            </div>
            <Badge variant="secondary">{number.format(metric(filtered, dimension))} {totalLabel}</Badge>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {statusGroups.map(([status, rows]) => (
              <button
                key={status}
                onClick={() => openDetail({ kind: "status", value: status, label: "Ordens em " + status })}
                className="group rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
              >
                <div className="mb-4 flex items-center justify-between">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: STATUS_COLORS[status] ?? "#64748b" }} />
                  <ChevronRight className="h-4 w-4 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-600" />
                </div>
                <div className="text-sm font-medium text-slate-600">{status}</div>
                <div className="mt-1 text-2xl font-bold">{number.format(metric(rows, dimension))}</div>
              </button>
            ))}
          </div>
        </section>

        <section className="grid gap-5 xl:grid-cols-[1.45fr_1fr]">
          <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <div className="mb-5">
              <h2 className="text-lg font-bold">Ordens por processo</h2>
              <p className="text-sm text-slate-500">Volume por data de COT na dimensão selecionada.</p>
            </div>
            <div className="h-[360px]">
              {chartData.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                    <CartesianGrid vertical={false} stroke="#e2e8f0" />
                    <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} tickFormatter={(value) => number.format(value)} />
                    <Tooltip
                      formatter={(value, name, item) => {
                        const share = Number(item.payload[String(name) + "Share"] ?? 0);
                        return [
                          number.format(Number(value)) + " (" + share.toFixed(1).replace(".", ",") + "%)",
                          String(name),
                        ];
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    {statusGroups.map(([status]) => (
                      <Bar key={status} dataKey={status} stackId="status" fill={STATUS_COLORS[status] ?? "#64748b"} radius={[2, 2, 0, 0]}>
                        <LabelList
                          dataKey={status + "Share"}
                          position="center"
                          fill="#ffffff"
                          fontSize={11}
                          formatter={(value) => Number(value) >= 5 ? Number(value).toFixed(0) + "%" : ""}
                        />
                      </Bar>
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <EmptyState />
              )}
            </div>
          </article>

          <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <div className="mb-6">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold">Progresso por etapa</h2>
                <Badge variant="outline">bd_cot</Badge>
              </div>
              <p className="text-sm text-slate-500">Percentual do volume que alcançou ou ultrapassou cada etapa.</p>
            </div>
            <div className="space-y-6">
              {progressRows.map((item) => (
                <div key={item.label}>
                  <div className="mb-2 flex items-center justify-between text-sm">
                    <span className="font-semibold">{item.label}</span>
                    <span className="font-bold tabular-nums">{item.value.toFixed(1).replace(".", ",")}%</span>
                  </div>
                  <Progress
                    value={Math.min(100, item.value)}
                    className={
                      "h-3 bg-slate-100 " +
                      (item.color === "red" ? "[&_[data-slot=progress-indicator]]:bg-red-500" :
                      item.color === "orange" ? "[&_[data-slot=progress-indicator]]:bg-orange-500" :
                      item.color === "blue" ? "[&_[data-slot=progress-indicator]]:bg-blue-600" :
                      item.color === "green" ? "[&_[data-slot=progress-indicator]]:bg-emerald-500" :
                      "[&_[data-slot=progress-indicator]]:bg-purple-600")
                    }
                  />
                </div>
              ))}
            </div>
            <div className="mt-6 rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-500">
              Created considera o volume que já saiu da etapa. Picked e Checked consideram o volume que chegou à etapa ou avançou. Outbound considera somente o volume finalizado nessa etapa.
            </div>
          </article>
        </section>
      </div>

      <Sheet open={Boolean(detail)} onOpenChange={(open) => !open && setDetail(null)}>
        <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-5xl">
          <SheetHeader className="border-b border-slate-200 p-5">
            <SheetTitle>{detail?.label}</SheetTitle>
            <SheetDescription>{number.format(detailRows.length)} registros encontrados na seleção atual.</SheetDescription>
          </SheetHeader>
          <div className="border-b border-slate-200 p-4">
            <div className="relative max-w-sm">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <Input
                value={detailSearch}
                onChange={(event) => { setDetailSearch(event.target.value); setPage(1); }}
                placeholder="Buscar ordem, tracking ou parcela"
                className="pl-9"
              />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-slate-50">
                <TableRow>
                  <TableHead>Ordem</TableHead>
                  <TableHead>Tracking</TableHead>
                  <TableHead>COT</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Itens</TableHead>
                  <TableHead>Última atualização</TableHead>
                  <TableHead>Sinalização</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleDetails.map((row, index) => (
                  <TableRow key={row.o + "-" + index}>
                    <TableCell className="font-mono text-xs">{row.o}</TableCell>
                    <TableCell className="font-mono text-xs">{row.t}</TableCell>
                    <TableCell>{formatDate(row.d)}</TableCell>
                    <TableCell><Badge variant="outline">{row.s}</Badge></TableCell>
                    <TableCell>{number.format(row.q)}</TableCell>
                    <TableCell className="whitespace-nowrap text-sm">{row.l || "—"}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {row.x && <Badge className="bg-red-100 text-red-700">OOS</Badge>}
                        {row.u && <Badge className="bg-amber-100 text-amber-800">Urgente</Badge>}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="flex items-center justify-between border-t border-slate-200 bg-white p-4">
            <span className="text-sm text-slate-500">Página {page} de {pages}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="icon" disabled={page <= 1} onClick={() => setPage((value) => value - 1)} aria-label="Página anterior">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" disabled={page >= pages} onClick={() => setPage((value) => value + 1)} aria-label="Próxima página">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </main>
  );
}

function MetricCard({
  label,
  value,
  note,
  icon,
  accent,
  onClick,
}: {
  label: string;
  value: number;
  note: string;
  icon: React.ReactNode;
  accent: "navy" | "red" | "amber" | "purple";
  onClick: () => void;
}) {
  const styles = {
    navy: "bg-[#172b4d] text-white",
    red: "bg-red-600 text-white",
    amber: "bg-amber-400 text-slate-950",
    purple: "bg-purple-600 text-white",
  };
  return (
    <button onClick={onClick} className="group overflow-hidden rounded-2xl border border-slate-200 bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-center justify-between p-4">
        <div>
          <div className="text-sm font-medium text-slate-500">{label}</div>
          <div className="mt-1 text-3xl font-bold">{number.format(value)}</div>
          <div className="mt-1 text-xs text-slate-400">{note}</div>
        </div>
        <div className={"rounded-xl p-3 " + styles[accent]}>{icon}</div>
      </div>
      <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2 text-xs font-semibold text-slate-500">
        Ver detalhes <ChevronRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
      </div>
    </button>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-500">
      Nenhum dado encontrado para os filtros selecionados.
    </div>
  );
}
