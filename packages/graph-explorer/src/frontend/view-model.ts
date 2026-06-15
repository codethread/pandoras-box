import type { FrontendDaemonStatus, FrontendGraphSnapshot, FrontendTaskSnapshot } from "./api.js";
import type { GraphViewModel } from "./graph/graph-adapter.js";
import type { GraphDiff } from "./graph/graph-diff.js";
import type { ExplorerRouteState } from "./routes.js";
import type {
	GraphExplorerSettings,
	ScopeViewSetting,
	TimeFilterSetting,
} from "./stores/settings-store.js";
import type { FreshnessState, WebsocketViewState } from "./stores/websocket-store.js";

export interface HeaderStatusModel {
	readonly daemonStatus: FrontendDaemonStatus | null;
	readonly websocket: WebsocketViewState;
	readonly freshness: FreshnessState;
	readonly lastGraphUpdateLabel: string;
	readonly refreshInFlight: boolean;
	readonly errorMessage: string | null;
	readonly staleMessage: string | null;
	readonly settingsNotice: string | null;
}

export interface InspectorState {
	readonly selectedTaskId: string | null;
	readonly taskSnapshot: FrontendTaskSnapshot | null;
	readonly loading: boolean;
	readonly errorMessage: string | null;
}

export interface AppRenderModel {
	readonly route: ExplorerRouteState;
	readonly settings: GraphExplorerSettings;
	readonly activeScopeView: ScopeViewSetting;
	readonly activeSelectorLabel: string;
	readonly activeTimeFilter: TimeFilterSetting;
	readonly graphSnapshot: FrontendGraphSnapshot | null;
	readonly graphView: GraphViewModel | null;
	readonly graphDiff: GraphDiff;
	readonly inspector: InspectorState;
	readonly header: HeaderStatusModel;
	readonly hasTaskFocus: boolean;
	readonly graphEmptyMessage: string;
}
