import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Building2,
  Users,
  LayoutDashboard,
  Columns3,
  CheckSquare,
  LogOut,
  ArrowUpRight,
  Plus,
  Search,
  ArrowRight,
  Activity,
} from "lucide-react";
import "./styles.css";

type Row = Record<string, any>;
type User = {
  id: number;
  name: string;
  role: "ADMIN" | "SALES";
  email: string;
  isDemo: boolean;
  demoExpiresAt: string | null;
};
type Page = "Overview" | "Companies" | "Contacts" | "Pipeline" | "Tasks";
const stages = [
  "NEW",
  "CONTACTED",
  "DEMO_SCHEDULED",
  "PROPOSAL_SENT",
  "WON",
  "LOST",
];
const label = (s: string) =>
  s
    .toLowerCase()
    .split("_")
    .map((s) => s[0].toUpperCase() + s.slice(1))
    .join(" ");
const money = (v: unknown) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Number(v));
const day = (s: string) => s?.slice(0, 10);
let csrf = "";
class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public issues: string[] = [],
  ) {
    super([message, ...issues].join(" · "));
  }
}
async function api(path: string, method = "GET", body?: unknown) {
  const requestCsrf = csrf;
  const response = await fetch("/api" + path, {
    method,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(method === "GET" ? {} : { "x-csrf-token": requestCsrf }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data =
    response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const error = new ApiError(
      response.status,
      data?.message || response.statusText,
      data?.issues,
    );
    if (
      response.status === 401 &&
      path !== "/auth/login" &&
      requestCsrf === csrf
    )
      window.dispatchEvent(new Event("session-expired"));
    throw error;
  }
  return data;
}
const endpoints: Record<Page, string> = {
  Overview: "",
  Companies: "companies",
  Contacts: "contacts",
  Pipeline: "opportunities",
  Tasks: "tasks",
};
const icons = {
  Overview: LayoutDashboard,
  Companies: Building2,
  Contacts: Users,
  Pipeline: Columns3,
  Tasks: CheckSquare,
};
function App() {
  const [user, setUser] = useState<User | null>(null),
    [demoEnabled, setDemoEnabled] = useState(false),
    [boot, setBoot] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [page, setPage] = useState<Page>("Overview"),
    [data, setData] = useState<Row>({ items: [], total: 0 }),
    [summary, setSummary] = useState<Row>({}),
    [loading, setLoading] = useState(false),
    [q, setQ] = useState(""),
    [current, setCurrent] = useState(1),
    [filter, setFilter] = useState("upcoming");
  const [detail, setDetail] = useState<Row | null>(null),
    [form, setForm] = useState<{ kind: string; record?: Row } | null>(null),
    [confirm, setConfirm] = useState<{ path: string; name: string } | null>(
      null,
    ),
    [revision, setRevision] = useState(0);
  const refresh = () => setRevision((v) => v + 1);
  const sessionGeneration = React.useRef(0);
  useEffect(() => {
    const expired = () => {
      sessionGeneration.current++;
      csrf = "";
      setUser(null);
      setDetail(null);
      setForm(null);
      setConfirm(null);
      setData({ items: [], total: 0 });
      setSummary({});
      setPage("Overview");
      setCurrent(1);
      setQ("");
      setFilter("upcoming");
      setNotice("");
      setError("Your session has expired. Sign in again.");
    };
    window.addEventListener("session-expired", expired);
    return () => window.removeEventListener("session-expired", expired);
  }, []);
  React.useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, [user?.id, page, detail?.id]);
  useEffect(() => {
    api("/auth/session")
      .then((s) => {
        csrf = s.csrf;
        setDemoEnabled(s.demoEnabled);
        setUser(s.user);
      })
      .catch((e) => setError(e.message))
      .finally(() => setBoot(false));
  }, []);
  useEffect(() => {
    if (!user) return;
    let live = true;
    const check = () => {
      void api("/auth/session")
        .then((s) => {
          if (live && !s.user)
            window.dispatchEvent(new Event("session-expired"));
        })
        .catch(() => {
          /* A network failure does not imply an expired session. */
        });
    };
    const timer = window.setInterval(check, 60000);
    window.addEventListener("focus", check);
    return () => {
      live = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", check);
    };
  }, [user]);
  useEffect(() => {
    if (!user) return;
    let live = true;
    setLoading(true);
    setError("");
    const query = `?page=${current}&q=${encodeURIComponent(q)}${page === "Tasks" ? "&filter=" + filter : ""}`;
    Promise.all([
      api("/summary"),
      page === "Overview"
        ? Promise.resolve({ items: [], total: 0 })
        : api("/" + endpoints[page] + query),
    ])
      .then(([s, d]) => {
        if (live) {
          setSummary(s);
          const last = Math.max(1, Math.ceil(d.total / (d.pageSize || 10)));
          if (current > last) {
            setData({ items: [], total: d.total });
            setCurrent(last);
            return;
          }
          setData(d);
        }
      })
      .catch((e) => {
        if (live && !(e instanceof ApiError && e.status === 401))
          setError(e.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [user, page, q, current, filter, revision]);
  async function openOpportunity(id: number) {
    const generation = sessionGeneration.current;
    try {
      const result = await api("/opportunities/" + id);
      if (generation === sessionGeneration.current) setDetail(result);
    } catch (e) {
      if (generation === sessionGeneration.current)
        setError((e as Error).message);
    }
  }
  async function mutate(path: string, method: string, body?: unknown) {
    const generation = sessionGeneration.current;
    try {
      await api(path, method, body);
      if (generation !== sessionGeneration.current) return false;
      const deletedDetail =
        method === "DELETE" && detail && path === "/opportunities/" + detail.id;
      if (deletedDetail) {
        setDetail(null);
        setPage("Pipeline");
      }
      setNotice(method === "DELETE" ? "Record deleted" : "Changes saved");
      setError("");
      refresh();
      if (detail && !deletedDetail) await openOpportunity(detail.id);
      return true;
    } catch (e) {
      if (generation === sessionGeneration.current)
        setError((e as Error).message);
      return false;
    }
  }
  function navigate(p: Page) {
    setData({ items: [], total: 0 });
    setPage(p);
    setDetail(null);
    setQ("");
    setCurrent(1);
    setNotice("");
  }
  if (boot)
    return (
      <div className="boot" role="status">
        Opening your workspace…
      </div>
    );
  if (!user)
    return (
      <Login
        error={error}
        demoEnabled={demoEnabled}
        onLogin={(u) => {
          setUser(u);
          setError("");
        }}
      />
    );
  const title = detail
    ? detail.title
    : page === "Overview"
      ? "A clearer view. A stronger pipeline."
      : page;
  async function signOut() {
    try {
      await api("/auth/logout", "POST");
      sessionGeneration.current++;
      csrf = "";
      setUser(null);
      setData({ items: [], total: 0 });
      setSummary({});
      setDetail(null);
      setForm(null);
      setConfirm(null);
      setCurrent(1);
      setQ("");
      setPage("Overview");
      setError("");
      setNotice("");
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 401))
        setError((e as Error).message);
    }
  }
  return (
    <div className="shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            navigate("Overview");
          }}
        >
          <span className="brand-icon">
            <Activity size={24} />
          </span>
          ClientFlow<span className="brand-dot">.</span>
        </a>
        <div className="workspace-label">SALES WORKSPACE</div>
        <nav aria-label="Main navigation">
          {(Object.keys(icons) as Page[]).map((p) => {
            const Icon = icons[p];
            return (
              <button
                key={p}
                aria-label={p}
                className={page === p ? "nav active" : "nav"}
                onClick={() => navigate(p)}
                aria-current={page === p ? "page" : undefined}
              >
                <Icon size={19} />
                <span>{p}</span>
                {p === "Pipeline" && (
                  <span className="nav-count">
                    {summary.openOpportunities ?? "—"}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="workspace-note">
            <span className="live-dot" /> A little more momentum.
            <p>Your relationships, moving forward.</p>
          </div>
          <div className="identity">
            <span className="avatar">
              {user.name
                .split(" ")
                .map((s) => s[0])
                .join("")}
            </span>
            <div>
              <strong>{user.name}</strong>
              <small>
                {user.role === "ADMIN"
                  ? "Administrator"
                  : "Sales representative"}
              </small>
            </div>
            <button
              className="icon-button"
              aria-label={user.isDemo ? "Exit demo" : "Sign out"}
              onClick={signOut}
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <span>
            Workspace <span className="slash">/</span> <strong>{page}</strong>
          </span>
          <span className="top-date">
            {new Date().toLocaleDateString("en-US", {
              month: "long",
              day: "numeric",
              year: "numeric",
              timeZone: "UTC",
            })}{" "}
            <span className="timezone">UTC</span>
          </span>
        </header>
        <div className="content">
          {user.isDemo && (
            <section className="demo-banner" aria-label="Demo workspace">
              <div>
                <strong>Demo workspace</strong>
                <p>
                  Changes are temporary. Do not enter personal or confidential
                  information. Access lasts one hour.
                </p>
              </div>
              <button onClick={signOut}>Exit demo</button>
            </section>
          )}
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {detail
                  ? "OPPORTUNITY DETAILS"
                  : page === "Overview"
                    ? "YOUR BUSINESS, AT A GLANCE"
                    : "RELATIONSHIPS IN MOTION"}
              </div>
              <h1>{title}</h1>
              <p>
                {detail
                  ? detail.company.name
                  : page === "Overview"
                    ? `Welcome back, ${user.name.split(" ")[0]}. Here’s where things stand.`
                    : page === "Companies"
                      ? "The organizations behind your next opportunity."
                      : page === "Contacts"
                        ? "Good business starts with the right people."
                        : page === "Pipeline"
                          ? "Turn promising conversations into lasting partnerships."
                          : "Keep the next step in sight."}
              </p>
            </div>
            {page !== "Overview" && !detail && (
              <button
                className="primary"
                onClick={(e) => {
                  e.currentTarget.focus();
                  setForm({ kind: endpoints[page] });
                }}
              >
                <Plus size={17} />{" "}
                {page === "Pipeline"
                  ? "New opportunity"
                  : page === "Tasks"
                    ? "New task"
                    : page === "Contacts"
                      ? "New contact"
                      : "New company"}
              </button>
            )}
          </div>
          {error && (
            <div className="alert error" role="alert">
              {error}
              <button onClick={() => setError("")} aria-label="Dismiss error">
                ×
              </button>
            </div>
          )}
          {notice && (
            <div className="alert success" role="status">
              {notice}
              <button
                onClick={() => setNotice("")}
                aria-label="Dismiss notification"
              >
                ×
              </button>
            </div>
          )}
          {loading && (
            <div className="loading" role="status">
              Updating workspace…
            </div>
          )}
          {detail ? (
            <OpportunityDetail
              detail={detail}
              onBack={() => setDetail(null)}
              onEdit={() => setForm({ kind: "opportunities", record: detail })}
              onTask={() =>
                setForm({
                  kind: "tasks",
                  record: {
                    opportunityId: detail.id,
                    assignedToId: detail.assignedToId,
                  },
                })
              }
              onDelete={() =>
                setConfirm({
                  path: "/opportunities/" + detail.id,
                  name: detail.title,
                })
              }
              mutate={mutate}
              removeNote={(n) =>
                setConfirm({ path: "/notes/" + n.id, name: "this note" })
              }
            />
          ) : page === "Overview" ? (
            <>
              <div className="metrics">
                {[
                  [
                    "Companies",
                    summary.companies,
                    Building2,
                    "Organizations in your workspace",
                  ],
                  [
                    "Open opportunities",
                    summary.openOpportunities,
                    Columns3,
                    "All stages before Won or Lost",
                  ],
                  [
                    "Open pipeline value",
                    summary.openValue === undefined
                      ? "—"
                      : money(summary.openValue),
                    ArrowUpRight,
                    "Estimated USD value of open deals",
                  ],
                  [
                    "Won value",
                    summary.wonValue === undefined
                      ? "—"
                      : money(summary.wonValue),
                    CheckSquare,
                    "Total USD value of won deals",
                  ],
                  [
                    "Overdue tasks",
                    summary.overdueTasks,
                    Activity,
                    "Incomplete tasks before today (UTC)",
                  ],
                ].map(([name, value, Icon, desc]) => {
                  const I = Icon as typeof Building2;
                  return (
                    <div className="metric" key={String(name)}>
                      <div className="metric-top">
                        <span>{String(name)}</span>
                        <I size={18} />
                      </div>
                      <strong>{value ?? "—"}</strong>
                      <small>{String(desc)}</small>
                    </div>
                  );
                })}
              </div>
              <div className="overview-grid">
                <section className="panel journey">
                  <div className="section-kicker">MAKE YOUR NEXT MOVE</div>
                  <h2>
                    Good relationships.
                    <br />
                    Real opportunities.
                  </h2>
                  <p>
                    Build your customer network, keep conversations moving, and
                    make every follow-up count.
                  </p>
                  <button
                    className="primary"
                    onClick={() => navigate("Pipeline")}
                  >
                    Explore your pipeline <ArrowRight size={17} />
                  </button>
                  <div className="journey-path">
                    <span>Connect</span>
                    <i />
                    <span>Develop</span>
                    <i />
                    <span>Close</span>
                  </div>
                </section>
                <section className="panel quick">
                  <h2>Your workspace</h2>
                  <p>A focused place for the entire sales journey.</p>
                  {(
                    [
                      ["Companies", "Build your customer network"],
                      ["Contacts", "Find the right conversation"],
                      ["Tasks", "Follow through on the details"],
                    ] as [Page, string][]
                  ).map(([p, d]) => {
                    const I = icons[p];
                    return (
                      <button key={p} onClick={() => navigate(p)}>
                        <span className="quick-icon">
                          <I size={21} />
                        </span>
                        <span>
                          <strong>{p}</strong>
                          <small>{d}</small>
                        </span>
                        <ArrowUpRight size={19} />
                      </button>
                    );
                  })}
                </section>
              </div>
              <div className="footnote">
                <span className="live-dot" /> All metrics reflect records you’re
                authorized to access. Values are estimates in USD.
              </div>
            </>
          ) : (
            <>
              <div className="toolbar">
                <label className="search">
                  <Search size={18} />
                  <input
                    aria-label={`Search ${page.toLowerCase()}`}
                    placeholder={`Search ${page === "Pipeline" ? "opportunities" : page.toLowerCase()}…`}
                    value={q}
                    onChange={(e) => {
                      setQ(e.target.value);
                      setCurrent(1);
                    }}
                  />
                </label>
                {page === "Tasks" && (
                  <label className="filter">
                    Show{" "}
                    <select
                      aria-label="Task filter"
                      value={filter}
                      onChange={(e) => {
                        setFilter(e.target.value);
                        setCurrent(1);
                      }}
                    >
                      {["upcoming", "overdue", "completed", "all"].map((f) => (
                        <option key={f} value={f}>
                          {label(f)}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <span className="record-count">
                  {data.total} matching records · all pages
                </span>
              </div>
              {page === "Pipeline" ? (
                <div className="board">
                  {stages.map((stage) => {
                    const rows = data.items.filter(
                      (r: Row) => r.stage === stage,
                    );
                    return (
                      <section className="lane" key={stage}>
                        <h2>
                          <span className={"stage-dot " + stage} />
                          {label(stage)}
                          <small className="page-count-label">
                            on this page
                          </small>
                          <span>{rows.length}</span>
                        </h2>
                        {rows.map((r: Row) => (
                          <article className="deal" key={r.id}>
                            <div className="deal-company">{r.company.name}</div>
                            <button
                              className="deal-title"
                              onClick={() => openOpportunity(r.id)}
                            >
                              {r.title}
                            </button>
                            <strong>{money(r.value)}</strong>
                            <div className="deal-meta">
                              <span>Close {day(r.expectedCloseDate)}</span>
                              <span
                                className="tiny-avatar"
                                title={r.assignedTo.name}
                              >
                                {r.assignedTo.name
                                  .split(" ")
                                  .map((s: string) => s[0])
                                  .join("")}
                              </span>
                            </div>
                            <label className="stage-label">
                              Stage
                              <select
                                aria-label={`Stage for ${r.title}`}
                                value={r.stage}
                                onChange={(e) =>
                                  mutate(
                                    "/opportunities/" + r.id + "/stage",
                                    "PATCH",
                                    { stage: e.target.value },
                                  )
                                }
                              >
                                {stages.map((s) => (
                                  <option key={s} value={s}>
                                    {label(s)}
                                  </option>
                                ))}
                              </select>
                            </label>
                          </article>
                        ))}
                        {!rows.length && (
                          <p className="lane-empty">
                            No opportunities on this page
                          </p>
                        )}
                      </section>
                    );
                  })}
                </div>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        {(page === "Companies"
                          ? [
                              "Company",
                              "Industry",
                              "Representative",
                              "Contacts",
                              "Actions",
                            ]
                          : page === "Contacts"
                            ? [
                                "Contact",
                                "Company",
                                "Email",
                                "Phone",
                                "Actions",
                              ]
                            : [
                                "Task",
                                "Opportunity",
                                "Due date (UTC)",
                                "Status",
                                "Actions",
                              ]
                        ).map((h) => (
                          <th key={h}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.items.map((r: Row) => (
                        <tr key={r.id}>
                          {page === "Companies" ? (
                            <>
                              <td>
                                <strong>{r.name}</strong>
                                <small>{r.website || "No website added"}</small>
                              </td>
                              <td>{r.industry || "—"}</td>
                              <td>{r.assignedTo.name}</td>
                              <td>{r._count.contacts}</td>
                            </>
                          ) : page === "Contacts" ? (
                            <>
                              <td>
                                <strong>{r.name}</strong>
                                <small>{r.jobTitle || "No title added"}</small>
                              </td>
                              <td>{r.company.name}</td>
                              <td>{r.email || "—"}</td>
                              <td>{r.phone || "—"}</td>
                            </>
                          ) : (
                            <>
                              <td>
                                <strong>{r.title}</strong>
                                <small>{r.assignedTo.name}</small>
                              </td>
                              <td>
                                <button
                                  className="text-button"
                                  onClick={() =>
                                    openOpportunity(r.opportunityId)
                                  }
                                >
                                  {r.opportunity.title}
                                </button>
                              </td>
                              <td>{day(r.dueDate)}</td>
                              <td>
                                <label className="check">
                                  <TaskCheckbox
                                    completed={r.completed}
                                    title={r.title}
                                    onToggle={(completed) =>
                                      mutate("/tasks/" + r.id, "PATCH", {
                                        completed,
                                      })
                                    }
                                  />
                                  {r.completed ? "Completed" : "Open"}
                                </label>
                              </td>
                            </>
                          )}
                          <td>
                            <div className="actions">
                              <button
                                onClick={async (event) => {
                                  event.currentTarget.focus();
                                  try {
                                    const record = await api(
                                      "/" + endpoints[page] + "/" + r.id,
                                    );
                                    setForm({ kind: endpoints[page], record });
                                  } catch (e) {
                                    if (!(
                                      e instanceof ApiError && e.status === 401
                                    ))
                                      setError((e as Error).message);
                                  }
                                }}
                              >
                                View / edit
                              </button>
                              <button
                                className="danger-link"
                                onClick={(e) => {
                                  e.currentTarget.focus();
                                  setConfirm({
                                    path: "/" + endpoints[page] + "/" + r.id,
                                    name: r.name || r.title,
                                  });
                                }}
                              >
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!data.items.length && !loading && (
                    <div className="empty">
                      <Building2 size={30} />
                      <h2>
                        {q
                          ? "No matches found"
                          : "Room for your next connection"}
                      </h2>
                      <p>
                        {q
                          ? "Try a different search."
                          : "Create your first record to start moving forward."}
                      </p>
                    </div>
                  )}
                </div>
              )}
              <div className="pagination">
                <span>
                  {data.total
                    ? `Page ${Math.min(current, Math.ceil(data.total / 10))} of ${Math.ceil(data.total / 10)}`
                    : "No records"}
                </span>
                <div>
                  <button
                    disabled={current === 1 || loading}
                    onClick={() => setCurrent((n) => n - 1)}
                  >
                    Previous
                  </button>
                  <button
                    disabled={current * 10 >= data.total || loading}
                    onClick={() => setCurrent((n) => n + 1)}
                  >
                    Next
                  </button>
                </div>
              </div>
              {page === "Pipeline" && (
                <p className="footnote">
                  Column counts show cards on the current page (up to 10 across
                  all columns). Record totals include all matching
                  opportunities; dashboard metrics include all authorized
                  records.
                </p>
              )}
            </>
          )}
          <footer>
            ClientFlow <span>Built around better relationships.</span>
          </footer>
        </div>
      </main>
      {form && (
        <RecordForm
          kind={form.kind}
          record={form.record}
          user={user}
          close={() => setForm(null)}
          saved={() => {
            setForm(null);
            setNotice("Record saved");
            refresh();
            if (detail) void openOpportunity(detail.id);
          }}
        />
      )}
      {confirm && (
        <Dialog title="Delete record?" close={() => setConfirm(null)}>
          <p>
            Delete <strong>{confirm.name}</strong>? This cannot be undone.
            Linked records must be removed first.
          </p>
          <div className="dialog-actions">
            <button onClick={() => setConfirm(null)}>Cancel</button>
            <button
              className="danger"
              onClick={async () => {
                const c = confirm;
                setConfirm(null);
                await mutate(c.path, "DELETE");
              }}
            >
              Delete record
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
function TaskCheckbox({
  completed,
  title,
  onToggle,
}: {
  completed: boolean;
  title: string;
  onToggle: (completed: boolean) => Promise<boolean>;
}) {
  const [checked, setChecked] = useState(completed),
    [busy, setBusy] = useState(false);
  useEffect(() => setChecked(completed), [completed]);
  return (
    <input
      type="checkbox"
      aria-label={"Complete " + title}
      checked={checked}
      disabled={busy}
      onChange={async (e) => {
        const next = e.target.checked;
        setChecked(next);
        setBusy(true);
        try {
          if (!(await onToggle(next))) setChecked(completed);
        } catch {
          setChecked(completed);
        } finally {
          setBusy(false);
        }
      }}
    />
  );
}
function Login({
  error,
  demoEnabled,
  onLogin,
}: {
  error: string;
  demoEnabled: boolean;
  onLogin: (u: User) => void;
}) {
  const [message, setMessage] = useState(error),
    [busy, setBusy] = useState(false);
  return (
    <div className="login-layout">
      <section className="login-story">
        <a className="brand" href="#">
          <span className="brand-icon">
            <Activity />
          </span>
          ClientFlow.
        </a>
        <div>
          <div className="eyebrow">RELATIONSHIPS IN MOTION</div>
          <h1>
            Your next chapter
            <br />
            starts with a<br />
            <em>conversation.</em>
          </h1>
          <p>
            One workspace for your customers, your pipeline,
            <br />
            and everything that moves your business forward.
          </p>
          <div className="login-line">
            <span>Connect</span>
            <i />
            <span>Develop</span>
            <i />
            <span>Grow</span>
          </div>
        </div>
        <small>Customer relationships. Clearly connected.</small>
      </section>
      <section className="login-form">
        <div className="eyebrow">WELCOME TO YOUR WORKSPACE</div>
        <h2>Good to see you.</h2>
        <p>Sign in to keep your relationships moving.</p>
        {message && (
          <div role="alert" className="alert error">
            {message}
          </div>
        )}
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const f = new FormData(e.currentTarget);
            try {
              const s = await api("/auth/session");
              csrf = s.csrf;
              const r = await api("/auth/login", "POST", {
                email: f.get("email"),
                password: f.get("password"),
              });
              csrf = r.csrf;
              onLogin(r.user);
            } catch (err) {
              setMessage((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Email address
            <input
              type="email"
              name="email"
              autoComplete="username"
              required
              placeholder="you@company.com"
            />
          </label>
          <label>
            Password
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              required
            />
          </label>
          <button className="primary" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
            <ArrowRight size={18} />
          </button>
        </form>
        {demoEnabled && (
          <div className="demo-entry">
            <button
              className="demo-button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setMessage("");
                try {
                  const session = await api("/auth/session");
                  csrf = session.csrf;
                  const result = await api("/auth/demo", "POST");
                  csrf = result.csrf;
                  onLogin(result.user);
                } catch (err) {
                  setMessage((err as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Try demo <ArrowRight size={18} />
            </button>
            <p>
              Explore a temporary workspace with sample data. No account
              required.
            </p>
          </div>
        )}
        <p className="login-help">
          Need access? Ask your workspace administrator.
          <br />
          Development accounts are configured during local setup.
        </p>
      </section>
    </div>
  );
}
function Dialog({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
}) {
  const ref = React.useRef<HTMLDialogElement>(null);
  React.useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const dialog = ref.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === ref.current) close();
      }}
      aria-labelledby="dialog-title"
    >
      <div className="dialog-head">
        <h2 id="dialog-title">{title}</h2>
        <button aria-label="Close dialog" onClick={close}>
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
async function allOptions(path: string) {
  let page = 1,
    items: Row[] = [];
  for (;;) {
    const d = await api(path + `?page=${page}`);
    items = items.concat(d.items);
    if (items.length >= d.total) return items;
    page++;
  }
}
function RecordForm({
  kind,
  record,
  user,
  close,
  saved,
}: {
  kind: string;
  record?: Row;
  user: User;
  close: () => void;
  saved: () => void;
}) {
  const editing = !!record?.id;
  const [values, setValues] = useState<Row>({
    ...record,
    assignedToId:
      record?.assignedToId || (user.role === "SALES" ? user.id : ""),
    contactId: record?.contactId || "",
    expectedCloseDate:
      day(record?.expectedCloseDate) || new Date().toISOString().slice(0, 10),
    dueDate: day(record?.dueDate) || new Date().toISOString().slice(0, 10),
    stage: record?.stage || "NEW",
    value: record?.value || "0",
  });
  const [reps, setReps] = useState<Row[]>([]),
    [companies, setCompanies] = useState<Row[]>([]),
    [contacts, setContacts] = useState<Row[]>([]),
    [opportunities, setOpportunities] = useState<Row[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [ready, setReady] = useState(false);
  useEffect(() => {
    Promise.all([
      api("/representatives"),
      allOptions("/companies"),
      kind === "opportunities" ? allOptions("/contacts") : Promise.resolve([]),
      kind === "tasks" ? allOptions("/opportunities") : Promise.resolve([]),
    ])
      .then(([r, c, ct, o]) => {
        setReps(r);
        setCompanies(c);
        setContacts(ct);
        setOpportunities(o);
        setReady(true);
      })
      .catch((e) => setError(e.message));
  }, [kind]);
  const update = (key: string, value: any) =>
    setValues((v) => {
      const next = { ...v, [key]: value };
      if (key === "companyId") {
        next.contactId = "";
        const c = companies.find((c) => c.id === Number(value));
        if (c) next.assignedToId = c.assignedToId;
      }
      if (key === "opportunityId") {
        const o = opportunities.find((o) => o.id === Number(value));
        if (o) next.assignedToId = o.assignedToId;
      }
      return next;
    });
  const field = (
    key: string,
    name: string,
    type = "text",
    required = false,
    maxLength = 160,
  ) => (
    <label key={key}>
      {name}
      {required ? " *" : ""}
      <input
        name={key}
        type={type}
        required={required}
        maxLength={maxLength}
        value={values[key] ?? ""}
        onChange={(e) => update(key, e.target.value)}
        {...(type === "number"
          ? { min: "0", max: "999999999999.99", step: "0.01" }
          : {})}
      />
    </label>
  );
  const select = (
    key: string,
    name: string,
    options: Row[],
    optional = false,
  ) => (
    <label key={key}>
      {name}
      {optional ? "" : " *"}
      <select
        required={!optional}
        aria-label={name}
        value={values[key] ?? ""}
        onChange={(e) => update(key, e.target.value)}
      >
        <option value="">{optional ? "None" : "Select…"}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name || o.title}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <Dialog
      title={
        (editing ? "View / edit " : "New ") +
        {
          companies: "company",
          contacts: "contact",
          opportunities: "opportunity",
          tasks: "task",
        }[kind]
      }
      close={close}
    >
      <p className="form-hint">
        Fields marked * are required. Dates use the UTC calendar.
      </p>
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      {!ready && <p role="status">Loading available relationships…</p>}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            const v = { ...values };
            for (const k of ["assignedToId", "companyId", "opportunityId"])
              if (v[k]) v[k] = Number(v[k]);
            v.contactId = v.contactId ? Number(v.contactId) : null;
            v.completed = !!v.completed;
            v.value = String(v.value);
            await api(
              "/" + kind + (editing ? "/" + record!.id : ""),
              editing ? "PUT" : "POST",
              v,
            );
            saved();
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="form-grid">
          {kind === "companies" ? (
            <>
              {field("name", "Company name", "text", true)}
              {field("industry", "Industry", "text", false, 120)}
              {field("website", "Website", "url", false, 500)}
              {field("phone", "Phone", "tel", false, 50)}
              {select("assignedToId", "Assigned representative", reps)}
            </>
          ) : kind === "contacts" ? (
            <>
              {field("name", "Contact name", "text", true)}
              {field("jobTitle", "Job title", "text", false, 120)}
              {field("email", "Email", "email", false, 190)}
              {field("phone", "Phone", "tel", false, 50)}
              {select("companyId", "Company", companies)}
            </>
          ) : kind === "opportunities" ? (
            <>
              {field("title", "Opportunity title", "text", true)}
              {select("companyId", "Company", companies)}
              {select(
                "contactId",
                "Contact",
                contacts.filter(
                  (c) => c.companyId === Number(values.companyId),
                ),
                true,
              )}
              {select("assignedToId", "Assigned representative", reps)}
              {field("value", "Estimated value (USD)", "number", true)}
              {field(
                "expectedCloseDate",
                "Expected closing date",
                "date",
                true,
              )}
              <label>
                Stage *
                <select
                  value={values.stage}
                  aria-label="Stage"
                  onChange={(e) => update("stage", e.target.value)}
                >
                  {stages.map((s) => (
                    <option key={s} value={s}>
                      {label(s)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="wide">
                Description
                <textarea
                  maxLength={10000}
                  rows={4}
                  value={values.description || ""}
                  onChange={(e) => update("description", e.target.value)}
                />
              </label>
            </>
          ) : (
            <>
              {field("title", "Task title", "text", true)}
              {select("opportunityId", "Linked opportunity", opportunities)}
              {select("assignedToId", "Assigned representative", reps)}
              {field("dueDate", "Due date", "date", true)}
              <label className="check">
                <input
                  type="checkbox"
                  checked={!!values.completed}
                  onChange={(e) => update("completed", e.target.checked)}
                />
                Completed
              </label>
            </>
          )}
        </div>
        {(kind === "opportunities" || kind === "tasks") && (
          <p className="form-hint">
            The representative must match the linked{" "}
            {kind === "tasks" ? "opportunity" : "company"}.
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button className="primary" disabled={busy || !ready}>
            {busy
              ? "Saving…"
              : "Save " +
                {
                  companies: "company",
                  contacts: "contact",
                  opportunities: "opportunity",
                  tasks: "task",
                }[kind]}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
function OpportunityDetail({
  detail: d,
  onBack,
  onEdit,
  onTask,
  onDelete,
  mutate,
  removeNote,
}: {
  detail: Row;
  onBack: () => void;
  onEdit: () => void;
  onTask: () => void;
  onDelete: () => void;
  mutate: (p: string, m: string, b?: unknown) => Promise<boolean>;
  removeNote: (n: Row) => void;
}) {
  const [note, setNote] = useState(""),
    [saving, setSaving] = useState(false);
  return (
    <>
      <div className="detail-toolbar">
        <button onClick={onBack}>← Back</button>
        <button
          onClick={(e) => {
            e.currentTarget.focus();
            onEdit();
          }}
        >
          Edit opportunity
        </button>
        <button
          className="danger-link"
          onClick={(e) => {
            e.currentTarget.focus();
            onDelete();
          }}
        >
          Delete
        </button>
      </div>
      <div className="detail-grid">
        <section className="panel">
          <div className="detail-summary">
            <strong>{money(d.value)}</strong>
            <span className="badge">{label(d.stage)}</span>
          </div>
          <label>
            Pipeline stage
            <select
              value={d.stage}
              onChange={(e) =>
                mutate("/opportunities/" + d.id + "/stage", "PATCH", {
                  stage: e.target.value,
                })
              }
            >
              {stages.map((s) => (
                <option key={s} value={s}>
                  {label(s)}
                </option>
              ))}
            </select>
          </label>
          <dl>
            <dt>Company</dt>
            <dd>{d.company.name}</dd>
            <dt>Contact</dt>
            <dd>{d.contact?.name || "Not linked"}</dd>
            <dt>Representative</dt>
            <dd>{d.assignedTo.name}</dd>
            <dt>Expected close (UTC)</dt>
            <dd>{day(d.expectedCloseDate)}</dd>
          </dl>
          <h3>Description</h3>
          <p className="preserve">{d.description || "No description yet."}</p>
        </section>
        <div>
          <section className="panel">
            <div className="section-head">
              <h2>Follow-up tasks</h2>
              <button
                onClick={(e) => {
                  e.currentTarget.focus();
                  onTask();
                }}
              >
                <Plus size={16} />
                Add task
              </button>
            </div>
            {!d.tasks.length && <p>No tasks yet. Schedule the next step.</p>}
            {d.tasks.map((t: Row) => (
              <label className="task-item" key={t.id}>
                <TaskCheckbox
                  title={t.title}
                  completed={t.completed}
                  onToggle={(completed) =>
                    mutate("/tasks/" + t.id, "PATCH", {
                      completed,
                    })
                  }
                />
                <span>
                  <strong>{t.title}</strong>
                  <small>
                    Due {day(t.dueDate)} · {t.completed ? "Completed" : "Open"}
                  </small>
                </span>
              </label>
            ))}
          </section>
          <section className="panel notes">
            <h2>Conversation notes</h2>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setSaving(true);
                if (
                  await mutate("/opportunities/" + d.id + "/notes", "POST", {
                    body: note,
                  })
                )
                  setNote("");
                setSaving(false);
              }}
            >
              <label htmlFor="note">
                Add a note
                <textarea
                  id="note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  required
                  maxLength={10000}
                  rows={3}
                  placeholder="What happened? What’s next?"
                />
              </label>
              <button className="primary" disabled={saving}>
                {saving ? "Adding…" : "Add note"}
              </button>
            </form>
            {!d.notes.length && <p>No notes yet.</p>}
            {d.notes.map((n: Row) => (
              <article className="note" key={n.id}>
                <div>
                  <strong>{n.author.name}</strong>
                  <time>
                    {new Date(n.createdAt).toLocaleString("en-US", {
                      timeZone: "UTC",
                    })}{" "}
                    UTC
                  </time>
                  <button className="danger-link" onClick={() => removeNote(n)}>
                    Delete note
                  </button>
                </div>
                <p className="preserve">{n.body}</p>
              </article>
            ))}
          </section>
        </div>
      </div>
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
