import type { ExplorerSelector } from "../types.js";
import type {
	ExplorerConfig,
	FrontendDaemonStatus,
	FrontendGraphSnapshot,
	FrontendTaskSnapshot,
} from "./api.js";
import {
	buildWebsocketSubscribeMessage,
	fetchDaemonStatus,
	fetchExplorerConfig,
	fetchGraphSnapshot,
	fetchTaskSnapshot,
	parseGraphWebsocketServerMessage,
} from "./api.js";
import { renderAppShell } from "./components/AppShell.js";
import { buildGraphViewModel, type GraphViewModel } from "./graph/graph-adapter.js";
import { diffGraphSnapshots, emptyGraphDiff, type GraphDiff } from "./graph/graph-diff.js";
import { GraphCanvasController } from "./graph/graph-canvas-controller.js";
import { graphVisualStyle } from "./graph/visual-style.js";
import { escapeHtml, formatIsoTimestamp, joinRenderedLines } from "./lib/utils.js";
import {
	parseExplorerRoute,
	pathForSelector,
	placeholderRoutes,
	type ExplorerRouteState,
} from "./routes.js";
import { defaultGraphStoreState } from "./stores/graph-store.js";
import { defaultLayoutState } from "./stores/layout-store.js";
import { emptySelectionState, reconcileSelectedTaskId } from "./stores/selection-store.js";
import {
	DEFAULT_REFRESH_INTERVAL_SECONDS,
	defaultSettingsState,
	loadSettings,
	saveSettings,
	scopeViewToSelector,
	timeFilterLabel,
	timeFilterRequestValidationMessage,
	updateRefreshInterval,
	updateScopeId,
	updateScopeViewMode,
	updateTimeFilter,
	type GraphExplorerSettings,
	type ScopeViewSetting,
	type TimeFilterSetting,
} from "./stores/settings-store.js";
import {
	computeFreshnessState,
	disconnectedWebsocketState,
	type WebsocketViewState,
} from "./stores/websocket-store.js";
import type { AppRenderModel } from "./view-model.js";

export interface FrontendBootstrap {
	readonly kind: "spa-shell";
	readonly routes: typeof placeholderRoutes;
	readonly graphStyle: typeof graphVisualStyle;
	readonly stores: {
		readonly graph: typeof defaultGraphStoreState;
		readonly layout: typeof defaultLayoutState;
		readonly selection: typeof emptySelectionState;
		readonly settings: typeof defaultSettingsState;
		readonly websocket: typeof disconnectedWebsocketState;
	};
}

interface AppState {
	readonly config: ExplorerConfig | null;
	readonly settings: GraphExplorerSettings;
	readonly route: ExplorerRouteState;
	readonly graphSnapshot: FrontendGraphSnapshot | null;
	readonly graphView: GraphViewModel | null;
	readonly graphDiff: GraphDiff;
	readonly daemonStatus: FrontendDaemonStatus | null;
	readonly selectedTaskId: string | null;
	readonly inspectorTask: FrontendTaskSnapshot | null;
	readonly inspectorLoading: boolean;
	readonly inspectorError: string | null;
	readonly refreshInFlight: boolean;
	readonly refreshError: string | null;
	readonly staleMessage: string | null;
	readonly settingsNotice: string | null;
	readonly websocket: WebsocketViewState;
	readonly lastGraphUpdateAt: string | null;
}

const graphExplorerGlobal = globalThis as typeof globalThis & {
	__PDX_GRAPH_EXPLORER_BOOTSTRAP__?: FrontendBootstrap;
};

graphExplorerGlobal.__PDX_GRAPH_EXPLORER_BOOTSTRAP__ = {
	kind: "spa-shell",
	routes: placeholderRoutes,
	graphStyle: graphVisualStyle,
	stores: {
		graph: defaultGraphStoreState,
		layout: defaultLayoutState,
		selection: emptySelectionState,
		settings: defaultSettingsState,
		websocket: disconnectedWebsocketState,
	},
};

class GraphExplorerApp {
	private readonly root: HTMLElement;
	private readonly storage: Storage | null;
	private readonly graphCanvas: GraphCanvasController;
	private state: AppState;
	private websocket: WebSocket | null = null;
	private refreshTimer: number | null = null;
	private freshnessTimer: number | null = null;
	private refreshGeneration = 0;
	private taskGeneration = 0;

	constructor(root: HTMLElement) {
		const storage = this.safeStorage();
		const loadedSettings = loadSettings(storage);
		const route = parseExplorerRoute(window.location.pathname);
		this.root = root;
		this.storage = storage;
		this.graphCanvas = new GraphCanvasController({
			onSelectTask: (taskId) => {
				void this.selectTask(taskId);
			},
		});
		this.state = {
			config: null,
			settings: loadedSettings.settings,
			route,
			graphSnapshot: null,
			graphView: null,
			graphDiff: emptyGraphDiff,
			daemonStatus: null,
			selectedTaskId: route.selectedTaskId,
			inspectorTask: null,
			inspectorLoading: false,
			inspectorError: null,
			refreshInFlight: false,
			refreshError: null,
			staleMessage: null,
			settingsNotice: loadedSettings.message,
			websocket: disconnectedWebsocketState,
			lastGraphUpdateAt: null,
		};
	}

	start = async (): Promise<void> => {
		this.bindEvents();
		this.render();
		try {
			const config = await fetchExplorerConfig();
			this.state = { ...this.state, config };
			this.render();
			await this.refreshNow();
			this.connectWebsocket();
			this.scheduleRefreshTimer();
			this.scheduleFreshnessTimer();
		} catch (error) {
			this.state = {
				...this.state,
				refreshError: error instanceof Error ? error.message : String(error),
				staleMessage: null,
			};
			this.render();
		}
	};

	private bindEvents = (): void => {
		this.root.addEventListener("click", (event) => {
			const target = event.target;
			if (!(target instanceof HTMLElement)) {
				return;
			}
			const button = target.closest("button[data-action]");
			if (!(button instanceof HTMLButtonElement)) {
				return;
			}
			void this.handleAction(button.dataset.action ?? "", button.dataset.value ?? null);
		});

		this.root.addEventListener("change", (event) => {
			const target = event.target;
			if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) {
				return;
			}
			void this.handleSettingChange(target.dataset.setting ?? "", target.value);
		});

		window.addEventListener("popstate", () => {
			const route = parseExplorerRoute(window.location.pathname);
			this.state = {
				...this.state,
				route,
				selectedTaskId: route.selectedTaskId,
			};
			this.sendCurrentSubscription();
			void this.refreshNow();
		});
	};

	private safeStorage = (): Storage | null => {
		try {
			return window.localStorage;
		} catch {
			return null;
		}
	};

	private activeSelector = (): ExplorerSelector => {
		const selectorOverride = this.state.route.selectorOverride;
		return selectorOverride ?? scopeViewToSelector(this.state.settings.scopeView);
	};

	private activeScopeView = (): ScopeViewSetting => {
		const selector = this.activeSelector();
		if (selector.kind === "task") {
			return this.state.settings.scopeView;
		}
		if (selector.kind === "scope") {
			return { kind: "scope", scopeId: selector.scopeId };
		}
		return { kind: selector.kind };
	};

	private activeSelectorLabel = (): string => {
		const selector = this.activeSelector();
		switch (selector.kind) {
			case "global":
				return "Global";
			case "all":
				return "All scopes";
			case "scope":
				return `Scope ${selector.scopeId}`;
			case "task":
				return `Task ${selector.taskId}`;
		}
	};

	private persistSettings = (): void => {
		saveSettings(this.storage, this.state.settings);
	};

	private sendCurrentSubscription = (): void => {
		if (this.websocket?.readyState !== WebSocket.OPEN) {
			return;
		}
		if (timeFilterRequestValidationMessage(this.state.settings.timeFilter) !== null) {
			return;
		}
		this.websocket.send(
			buildWebsocketSubscribeMessage(
				this.activeSelector(),
				this.state.settings.timeFilter,
				this.state.lastGraphUpdateAt,
			),
		);
	};

	private render = (): void => {
		const model: AppRenderModel = {
			route: this.state.route,
			settings: this.state.settings,
			activeScopeView: this.activeScopeView(),
			activeSelectorLabel: this.activeSelectorLabel(),
			activeTimeFilter: this.state.settings.timeFilter,
			graphSnapshot: this.state.graphSnapshot,
			graphView: this.state.graphView,
			graphDiff: this.state.graphDiff,
			inspector: {
				selectedTaskId: this.state.selectedTaskId,
				taskSnapshot: this.state.inspectorTask,
				loading: this.state.inspectorLoading,
				errorMessage: this.state.inspectorError,
			},
			header: {
				daemonStatus: this.state.daemonStatus,
				websocket: this.state.websocket,
				freshness: computeFreshnessState(
					this.state.lastGraphUpdateAt,
					new Date().toISOString(),
					this.state.settings.refreshIntervalSeconds,
				),
				lastGraphUpdateLabel:
					this.state.lastGraphUpdateAt === null
						? "never"
						: formatIsoTimestamp(this.state.lastGraphUpdateAt),
				refreshInFlight: this.state.refreshInFlight,
				errorMessage: this.state.refreshError,
				staleMessage: this.state.staleMessage,
				settingsNotice: this.state.settingsNotice,
			},
			hasTaskFocus: this.activeSelector().kind === "task",
			graphEmptyMessage:
				this.state.graphSnapshot === null
					? "No snapshot yet. Use Refresh now or wait for the first websocket push."
					: `Time filter: ${timeFilterLabel(this.state.settings.timeFilter)}. Data stays visible when refreshes fail.`,
		};
		this.root.innerHTML = renderAppShell(model);
		const graphCanvasHost = this.root.querySelector<HTMLElement>('[data-role="graph-canvas-host"]');
		if (graphCanvasHost !== null) {
			void this.graphCanvas.sync({
				host: graphCanvasHost,
				snapshot: this.state.graphSnapshot,
				graphDiff: this.state.graphDiff,
				selectedTaskId: this.state.selectedTaskId,
			});
		}
	};

	private setGraphSnapshot = (snapshot: FrontendGraphSnapshot): void => {
		const routeSelectedTaskId = this.state.route.selectedTaskId;
		const selectedTaskId =
			routeSelectedTaskId ??
			reconcileSelectedTaskId(
				this.state.selectedTaskId,
				snapshot.graph.nodes.map((node) => node.id),
			);
		this.state = {
			...this.state,
			graphDiff: diffGraphSnapshots(this.state.graphSnapshot, snapshot),
			graphSnapshot: snapshot,
			graphView: buildGraphViewModel(snapshot, selectedTaskId),
			selectedTaskId,
			lastGraphUpdateAt: snapshot.generatedAt,
			refreshError: null,
			staleMessage: null,
		};
		this.render();
		void this.refreshInspector();
	};

	private refreshNow = async (): Promise<void> => {
		const timeFilterNotice = timeFilterRequestValidationMessage(this.state.settings.timeFilter);
		if (timeFilterNotice !== null) {
			this.state = {
				...this.state,
				refreshInFlight: false,
				refreshError: null,
				staleMessage: null,
				settingsNotice: timeFilterNotice,
			};
			this.render();
			return;
		}
		const generation = ++this.refreshGeneration;
		this.state = {
			...this.state,
			refreshInFlight: true,
			refreshError: null,
			staleMessage: null,
			settingsNotice: null,
		};
		this.render();
		try {
			const [graphSnapshot, daemonStatus] = await Promise.all([
				fetchGraphSnapshot(this.activeSelector(), this.state.settings.timeFilter),
				fetchDaemonStatus(),
			]);
			if (generation !== this.refreshGeneration) {
				return;
			}
			this.state = {
				...this.state,
				daemonStatus,
				refreshInFlight: false,
			};
			this.setGraphSnapshot(graphSnapshot);
		} catch (error) {
			if (generation !== this.refreshGeneration) {
				return;
			}
			this.state = {
				...this.state,
				refreshInFlight: false,
				refreshError: error instanceof Error ? error.message : String(error),
				staleMessage: null,
			};
			this.render();
		}
	};

	private refreshInspector = async (): Promise<void> => {
		const taskId = this.state.selectedTaskId;
		if (taskId === null) {
			this.state = {
				...this.state,
				inspectorTask: null,
				inspectorLoading: false,
				inspectorError: null,
			};
			this.render();
			return;
		}
		const generation = ++this.taskGeneration;
		this.state = { ...this.state, inspectorLoading: true, inspectorError: null };
		this.render();
		try {
			const inspectorTask = await fetchTaskSnapshot(taskId);
			if (generation !== this.taskGeneration) {
				return;
			}
			this.state = {
				...this.state,
				inspectorTask,
				inspectorLoading: false,
				inspectorError: null,
			};
			this.render();
		} catch (error) {
			if (generation !== this.taskGeneration) {
				return;
			}
			this.state = {
				...this.state,
				inspectorLoading: false,
				inspectorError: error instanceof Error ? error.message : String(error),
			};
			this.render();
		}
	};

	private connectWebsocket = (): void => {
		if (this.state.config === null) {
			return;
		}
		const wsUrl = new URL(this.state.config.websocketPath, window.location.origin);
		wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
		this.state = {
			...this.state,
			websocket: {
				...this.state.websocket,
				status: this.state.websocket.reconnectAttempt > 0 ? "reconnecting" : "connecting",
				lastError: null,
			},
		};
		this.render();
		const socket = new WebSocket(wsUrl);
		this.websocket = socket;
		socket.addEventListener("open", () => {
			this.state = {
				...this.state,
				websocket: {
					status: "connected",
					lastMessageAt: this.state.websocket.lastMessageAt,
					lastError: null,
					reconnectAttempt: 0,
				},
			};
			this.sendCurrentSubscription();
			this.render();
		});
		socket.addEventListener("message", (event) => {
			try {
				if (typeof event.data !== "string") {
					throw new Error("Explorer websocket only supports text frames.");
				}
				const message = parseGraphWebsocketServerMessage(JSON.parse(event.data) as unknown);
				this.state = {
					...this.state,
					websocket: {
						status: "connected",
						lastMessageAt: new Date().toISOString(),
						lastError: null,
						reconnectAttempt: 0,
					},
				};
				if (message.kind === "snapshot") {
					this.setGraphSnapshot(message.snapshot);
					return;
				}
				if (message.kind === "daemon_status") {
					this.state = { ...this.state, daemonStatus: message.daemonStatus };
					this.render();
					return;
				}
				if (message.kind === "stale") {
					this.state = {
						...this.state,
						staleMessage:
							message.lastSuccessAt === null
								? message.message
								: `${message.message} Last good snapshot: ${formatIsoTimestamp(message.lastSuccessAt)}.`,
					};
					this.render();
					return;
				}
				this.state = {
					...this.state,
					refreshError: `${message.code}: ${message.message}`,
					staleMessage: null,
				};
				this.render();
			} catch (error) {
				this.state = {
					...this.state,
					websocket: {
						status: "error",
						lastMessageAt: this.state.websocket.lastMessageAt,
						lastError: error instanceof Error ? error.message : String(error),
						reconnectAttempt: this.state.websocket.reconnectAttempt,
					},
				};
				this.render();
			}
		});
		socket.addEventListener("close", () => {
			const reconnectAttempt = this.state.websocket.reconnectAttempt + 1;
			this.state = {
				...this.state,
				websocket: {
					status: "disconnected",
					lastMessageAt: this.state.websocket.lastMessageAt,
					lastError: this.state.websocket.lastError,
					reconnectAttempt,
				},
			};
			this.render();
			window.setTimeout(() => this.connectWebsocket(), Math.min(10_000, reconnectAttempt * 2_000));
		});
		socket.addEventListener("error", () => {
			this.state = {
				...this.state,
				websocket: {
					status: "error",
					lastMessageAt: this.state.websocket.lastMessageAt,
					lastError: "Websocket connection failed.",
					reconnectAttempt: this.state.websocket.reconnectAttempt,
				},
			};
			this.render();
		});
	};

	private scheduleRefreshTimer = (): void => {
		if (this.refreshTimer !== null) {
			window.clearInterval(this.refreshTimer);
		}
		this.refreshTimer = window.setInterval(() => {
			void this.refreshNow();
		}, this.state.settings.refreshIntervalSeconds * 1_000);
	};

	private scheduleFreshnessTimer = (): void => {
		if (this.freshnessTimer !== null) {
			window.clearInterval(this.freshnessTimer);
		}
		this.freshnessTimer = window.setInterval(() => {
			this.render();
		}, 5_000);
	};

	private applySelector = (selector: ExplorerSelector): void => {
		if (selector.kind !== "task") {
			this.state = {
				...this.state,
				settings: {
					...this.state.settings,
					scopeView:
						selector.kind === "scope"
							? { kind: "scope", scopeId: selector.scopeId }
							: { kind: selector.kind },
				},
			};
			this.persistSettings();
		}
		const path = pathForSelector(selector);
		history.pushState({}, "", path);
		this.state = {
			...this.state,
			route: parseExplorerRoute(path),
			selectedTaskId: selector.kind === "task" ? selector.taskId : this.state.selectedTaskId,
			settingsNotice: null,
		};
		this.sendCurrentSubscription();
		void this.refreshNow();
	};

	private selectTask = async (taskId: string): Promise<void> => {
		this.state = { ...this.state, selectedTaskId: taskId };
		this.render();
		await this.refreshInspector();
	};

	private handleAction = async (action: string, value: string | null): Promise<void> => {
		switch (action) {
			case "refresh":
				await this.refreshNow();
				return;
			case "reset-scope":
				this.state = {
					...this.state,
					settings: { ...this.state.settings, scopeView: { kind: "global" } },
				};
				this.persistSettings();
				this.applySelector({ kind: "global" });
				return;
			case "leave-task-focus":
				this.applySelector(scopeViewToSelector(this.state.settings.scopeView));
				return;
			case "reset-time-filter":
				this.state = {
					...this.state,
					settings: updateTimeFilter(this.state.settings, { kind: "off" }),
				};
				this.persistSettings();
				this.sendCurrentSubscription();
				await this.refreshNow();
				return;
			case "reset-refresh-interval":
				this.state = {
					...this.state,
					settings: updateRefreshInterval(this.state.settings, DEFAULT_REFRESH_INTERVAL_SECONDS),
				};
				this.persistSettings();
				this.scheduleRefreshTimer();
				this.render();
				return;
			case "select-task":
				if (value !== null) {
					await this.selectTask(value);
				}
				return;
			case "clear-selection":
				this.state = {
					...this.state,
					selectedTaskId: null,
					inspectorTask: null,
					inspectorError: null,
				};
				this.render();
				return;
			default:
				return;
		}
	};

	private handleSettingChange = async (setting: string, value: string): Promise<void> => {
		switch (setting) {
			case "scope-mode": {
				const nextMode = value === "all" ? "all" : value === "scope" ? "scope" : "global";
				const settings = updateScopeViewMode(this.state.settings, nextMode);
				this.state = { ...this.state, settings };
				this.persistSettings();
				if (settings.scopeView.kind === "scope" && settings.scopeView.scopeId.trim().length === 0) {
					this.state = {
						...this.state,
						settingsNotice: "Enter a scope id to activate specific-scope view.",
					};
					this.render();
					return;
				}
				this.applySelector(scopeViewToSelector(settings.scopeView));
				return;
			}
			case "scope-id": {
				const settings = updateScopeId(this.state.settings, value);
				const scopeId = settings.scopeView.kind === "scope" ? settings.scopeView.scopeId : "";
				this.state = { ...this.state, settings, settingsNotice: null };
				this.persistSettings();
				if (scopeId.length === 0) {
					this.render();
					return;
				}
				this.applySelector({ kind: "scope", scopeId });
				return;
			}
			case "time-filter-mode": {
				let timeFilter: TimeFilterSetting;
				switch (value) {
					case "off":
						timeFilter = { kind: "off" };
						break;
					case "absolute":
						timeFilter = {
							kind: "absolute",
							sinceLocal:
								this.state.settings.timeFilter.kind === "absolute"
									? this.state.settings.timeFilter.sinceLocal
									: "",
							untilLocal:
								this.state.settings.timeFilter.kind === "absolute"
									? this.state.settings.timeFilter.untilLocal
									: "",
						};
						break;
					case "30m":
					case "1h":
					case "6h":
					case "1d":
						timeFilter = { kind: "relative", value };
						break;
					default:
						return;
				}
				this.state = {
					...this.state,
					settings: updateTimeFilter(this.state.settings, timeFilter),
					settingsNotice: null,
				};
				this.persistSettings();
				this.sendCurrentSubscription();
				await this.refreshNow();
				return;
			}
			case "time-filter-absolute-since":
			case "time-filter-absolute-until": {
				const currentAbsolute =
					this.state.settings.timeFilter.kind === "absolute"
						? this.state.settings.timeFilter
						: { kind: "absolute" as const, sinceLocal: "", untilLocal: "" };
				this.state = {
					...this.state,
					settings: updateTimeFilter(this.state.settings, {
						kind: "absolute",
						sinceLocal:
							setting === "time-filter-absolute-since" ? value : currentAbsolute.sinceLocal,
						untilLocal:
							setting === "time-filter-absolute-until" ? value : currentAbsolute.untilLocal,
					}),
				};
				this.persistSettings();
				this.sendCurrentSubscription();
				await this.refreshNow();
				return;
			}
			case "refresh-interval":
				this.state = {
					...this.state,
					settings: updateRefreshInterval(this.state.settings, Number(value)),
				};
				this.persistSettings();
				this.scheduleRefreshTimer();
				this.render();
				return;
			default:
				return;
		}
	};
}

const root = document.getElementById("app");
if (root instanceof HTMLElement) {
	void new GraphExplorerApp(root).start();
} else {
	document.body.innerHTML = joinRenderedLines([
		'<main class="app-shell">',
		'<section class="panel">',
		"<h1>Pithos Graph Explorer</h1>",
		`<p class="banner banner--error">${escapeHtml("Missing #app mount element.")}</p>`,
		"</section>",
		"</main>",
	]);
}
