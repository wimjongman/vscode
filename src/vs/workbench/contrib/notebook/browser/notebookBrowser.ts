/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IMouseWheelEvent } from 'vs/base/browser/mouseEvent';
import { IListContextMenuEvent, IListEvent, IListMouseEvent } from 'vs/base/browser/ui/list/list';
import { IListOptions, IListStyles } from 'vs/base/browser/ui/list/listWidget';
import { ProgressBar } from 'vs/base/browser/ui/progressbar/progressbar';
import { ToolBar } from 'vs/base/browser/ui/toolbar/toolbar';
import { Emitter, Event } from 'vs/base/common/event';
import { DisposableStore, IDisposable } from 'vs/base/common/lifecycle';
import { ScrollEvent } from 'vs/base/common/scrollable';
import { URI } from 'vs/base/common/uri';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { BareFontInfo } from 'vs/editor/common/config/fontInfo';
import { IPosition } from 'vs/editor/common/core/position';
import { Range } from 'vs/editor/common/core/range';
import { FindMatch, IReadonlyTextBuffer, ITextModel } from 'vs/editor/common/model';
import { ContextKeyExpr, RawContextKey, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { OutputRenderer } from 'vs/workbench/contrib/notebook/browser/view/output/outputRenderer';
import { RunStateRenderer, TimerRenderer } from 'vs/workbench/contrib/notebook/browser/view/renderers/cellRenderer';
import { CellViewModel, IModelDecorationsChangeAccessor, NotebookViewModel } from 'vs/workbench/contrib/notebook/browser/viewModel/notebookViewModel';
import { NotebookCellTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookCellTextModel';
import { CellKind, NotebookCellMetadata, NotebookDocumentMetadata, IEditor, INotebookKernel, ICellRange, IOrderedMimeType, INotebookRendererInfo, ICellOutput, IOutputItemDto } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { Webview } from 'vs/workbench/contrib/webview/browser/webview';
import { NotebookTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookTextModel';
import { IMenu } from 'vs/platform/actions/common/actions';
import { EditorOptions, IEditorPane } from 'vs/workbench/common/editor';
import { IResourceEditorInput } from 'vs/platform/editor/common/editor';
import { IConstructorSignature1 } from 'vs/platform/instantiation/common/instantiation';
import { CellEditorStatusBar } from 'vs/workbench/contrib/notebook/browser/view/renderers/cellWidgets';

//#region Context Keys
export const KEYBINDING_CONTEXT_NOTEBOOK_FIND_WIDGET_FOCUSED = new RawContextKey<boolean>('notebookFindWidgetFocused', false);

// Is Notebook
export const NOTEBOOK_IS_ACTIVE_EDITOR = ContextKeyExpr.equals('activeEditor', 'workbench.editor.notebook');

// Editor keys
export const NOTEBOOK_EDITOR_FOCUSED = new RawContextKey<boolean>('notebookEditorFocused', false);
export const NOTEBOOK_EDITOR_OPEN = new RawContextKey<boolean>('notebookEditorOpen', false);
export const NOTEBOOK_CELL_LIST_FOCUSED = new RawContextKey<boolean>('notebookCellListFocused', false);
export const NOTEBOOK_OUTPUT_FOCUSED = new RawContextKey<boolean>('notebookOutputFocused', false);
export const NOTEBOOK_EDITOR_EDITABLE = new RawContextKey<boolean>('notebookEditable', true);
export const NOTEBOOK_EDITOR_RUNNABLE = new RawContextKey<boolean>('notebookRunnable', true);
export const NOTEBOOK_EDITOR_EXECUTING_NOTEBOOK = new RawContextKey<boolean>('notebookExecuting', false);

// Diff Editor Keys
export const IN_NOTEBOOK_TEXT_DIFF_EDITOR = new RawContextKey<boolean>('isInNotebookTextDiffEditor', false);

// Cell keys
export const NOTEBOOK_VIEW_TYPE = new RawContextKey<string>('notebookViewType', undefined);
export const NOTEBOOK_CELL_TYPE = new RawContextKey<string>('notebookCellType', undefined); // code, markdown
export const NOTEBOOK_CELL_EDITABLE = new RawContextKey<boolean>('notebookCellEditable', false); // bool
export const NOTEBOOK_CELL_FOCUSED = new RawContextKey<boolean>('notebookCellFocused', false); // bool
export const NOTEBOOK_CELL_EDITOR_FOCUSED = new RawContextKey<boolean>('notebookCellEditorFocused', false); // bool
export const NOTEBOOK_CELL_RUNNABLE = new RawContextKey<boolean>('notebookCellRunnable', false); // bool
export const NOTEBOOK_CELL_MARKDOWN_EDIT_MODE = new RawContextKey<boolean>('notebookCellMarkdownEditMode', false); // bool
export const NOTEBOOK_CELL_RUN_STATE = new RawContextKey<string>('notebookCellRunState', undefined); // idle, running
export const NOTEBOOK_CELL_HAS_OUTPUTS = new RawContextKey<boolean>('notebookCellHasOutputs', false); // bool
export const NOTEBOOK_CELL_INPUT_COLLAPSED = new RawContextKey<boolean>('notebookCellInputIsCollapsed', false); // bool
export const NOTEBOOK_CELL_OUTPUT_COLLAPSED = new RawContextKey<boolean>('notebookCellOutputIsCollapsed', false); // bool
// Kernels
export const NOTEBOOK_HAS_MULTIPLE_KERNELS = new RawContextKey<boolean>('notebookHasMultipleKernels', false);
export const NOTEBOOK_KERNEL_COUNT = new RawContextKey<number>('notebookKernelCount', 0);

//#endregion

//#region Shared commands
export const EXPAND_CELL_CONTENT_COMMAND_ID = 'notebook.cell.expandCellContent';
export const EXECUTE_CELL_COMMAND_ID = 'notebook.cell.execute';

//#endregion

//#region  Output related types
export const enum RenderOutputType {
	Mainframe,
	Html,
	Extension
}

export interface IRenderMainframeOutput {
	type: RenderOutputType.Mainframe;
	hasDynamicHeight: boolean;
	supportAppend?: boolean;
}

export interface IRenderPlainHtmlOutput {
	type: RenderOutputType.Html;
	source: IDisplayOutputViewModel;
	htmlContent: string;
	hasDynamicHeight: boolean;
}

export interface IRenderOutputViaExtension {
	type: RenderOutputType.Extension;
	source: IDisplayOutputViewModel;
	mimeType: string;
	renderer: INotebookRendererInfo;
}

export type IInsetRenderOutput = IRenderPlainHtmlOutput | IRenderOutputViaExtension;
export type IRenderOutput = IRenderMainframeOutput | IInsetRenderOutput;

export const outputHasDynamicHeight = (o: IRenderOutput) => o.type !== RenderOutputType.Extension && o.hasDynamicHeight;


export interface ICellOutputViewModel {
	cellViewModel: IGenericCellViewModel;
	/**
	 * When rendering an output, `model` should always be used as we convert legacy `text/error` output to `display_data` output under the hood.
	 */
	model: ICellOutput;
	resolveMimeTypes(textModel: NotebookTextModel): [readonly IOrderedMimeType[], number];
	pickedMimeType: number;
	supportAppend(): boolean;
	toRawJSON(): any;
}

export interface IDisplayOutputViewModel extends ICellOutputViewModel {
	resolveMimeTypes(textModel: NotebookTextModel): [readonly IOrderedMimeType[], number];
	pickedMimeType: number;
}


//#endregion

//#region Shared types between the Notebook Editor and Notebook Diff Editor, they are mostly used for output rendering

export interface IGenericCellViewModel {
	id: string;
	handle: number;
	uri: URI;
	metadata: NotebookCellMetadata | undefined;
	outputIsHovered: boolean;
	outputsViewModels: ICellOutputViewModel[];
	getOutputOffset(index: number): number;
	updateOutputHeight(index: number, height: number): void;
}

export interface IDisplayOutputLayoutUpdateRequest {
	output: IDisplayOutputViewModel;
	cellTop: number;
	outputOffset: number;
}

export interface ICommonCellInfo {
	cellId: string;
	cellHandle: number;
	cellUri: URI;
}

export interface INotebookCellOutputLayoutInfo {
	width: number;
	height: number;
	fontInfo: BareFontInfo;
}

export interface IFocusNotebookCellOptions {
	readonly skipReveal?: boolean;
}

export interface ICommonNotebookEditor {
	getCellOutputLayoutInfo(cell: IGenericCellViewModel): INotebookCellOutputLayoutInfo;
	triggerScroll(event: IMouseWheelEvent): void;
	getCellByInfo(cellInfo: ICommonCellInfo): IGenericCellViewModel;
	getCellById(cellId: string): IGenericCellViewModel | undefined;
	focusNotebookCell(cell: IGenericCellViewModel, focus: 'editor' | 'container' | 'output', options?: IFocusNotebookCellOptions): void;
	focusNextNotebookCell(cell: IGenericCellViewModel, focus: 'editor' | 'container' | 'output'): void;
	updateOutputHeight(cellInfo: ICommonCellInfo, output: IDisplayOutputViewModel, height: number, isInit: boolean): void;
	updateMarkdownCellHeight(cellId: string, height: number, isInit: boolean): void;
	setMarkdownCellEditState(cellId: string, editState: CellEditState): void;
	markdownCellDragStart(cellId: string, position: { clientY: number }): void;
	markdownCellDrag(cellId: string, position: { clientY: number }): void;
	markdownCellDragEnd(cellId: string, position: { clientY: number, ctrlKey: boolean, altKey: boolean }): void;
}

//#endregion

export interface NotebookLayoutInfo {
	width: number;
	height: number;
	fontInfo: BareFontInfo;
}

export interface NotebookLayoutChangeEvent {
	width?: boolean;
	height?: boolean;
	fontInfo?: boolean;
}

export enum CodeCellLayoutState {
	Uninitialized,
	Estimated,
	FromCache,
	Measured
}

export interface CodeCellLayoutInfo {
	readonly fontInfo: BareFontInfo | null;
	readonly editorHeight: number;
	readonly editorWidth: number;
	readonly totalHeight: number;
	readonly outputContainerOffset: number;
	readonly outputTotalHeight: number;
	readonly outputShowMoreContainerHeight: number;
	readonly outputShowMoreContainerOffset: number;
	readonly indicatorHeight: number;
	readonly bottomToolbarOffset: number;
	readonly layoutState: CodeCellLayoutState;
}

export interface CodeCellLayoutChangeEvent {
	editorHeight?: boolean;
	outputHeight?: boolean;
	outputShowMoreContainerHeight?: number;
	totalHeight?: boolean;
	outerWidth?: number;
	font?: BareFontInfo;
}

export interface MarkdownCellLayoutInfo {
	readonly fontInfo: BareFontInfo | null;
	readonly editorWidth: number;
	readonly editorHeight: number;
	readonly bottomToolbarOffset: number;
	readonly totalHeight: number;
}

export interface MarkdownCellLayoutChangeEvent {
	font?: BareFontInfo;
	outerWidth?: number;
	totalHeight?: number;
}

export interface ICellViewModel extends IGenericCellViewModel {
	readonly model: NotebookCellTextModel;
	readonly id: string;
	readonly textBuffer: IReadonlyTextBuffer;
	dragging: boolean;
	handle: number;
	uri: URI;
	language: string;
	cellKind: CellKind;
	editState: CellEditState;
	focusMode: CellFocusMode;
	outputIsHovered: boolean;
	getText(): string;
	getTextLength(): number;
	metadata: NotebookCellMetadata | undefined;
	textModel: ITextModel | undefined;
	hasModel(): this is IEditableCellViewModel;
	resolveTextModel(): Promise<ITextModel>;
	getEvaluatedMetadata(documentMetadata: NotebookDocumentMetadata | undefined): NotebookCellMetadata;
	getSelectionsStartPosition(): IPosition[] | undefined;
	getCellDecorations(): INotebookCellDecorationOptions[];
}

export interface IEditableCellViewModel extends ICellViewModel {
	textModel: ITextModel;
}

export interface INotebookEditorMouseEvent {
	readonly event: MouseEvent;
	readonly target: CellViewModel;
}

export interface INotebookEditorContribution {
	/**
	 * Dispose this contribution.
	 */
	dispose(): void;
	/**
	 * Store view state.
	 */
	saveViewState?(): unknown;
	/**
	 * Restore view state.
	 */
	restoreViewState?(state: unknown): void;
}

export interface INotebookCellDecorationOptions {
	className?: string;
	gutterClassName?: string;
	outputClassName?: string;
	topClassName?: string;
}

export interface INotebookDeltaDecoration {
	handle: number;
	options: INotebookCellDecorationOptions;
}

export class NotebookEditorOptions extends EditorOptions {

	readonly cellOptions?: IResourceEditorInput;
	readonly cellSelections?: ICellRange[];

	constructor(options: Partial<NotebookEditorOptions>) {
		super();
		this.overwrite(options);
		this.cellOptions = options.cellOptions;
	}

	with(options: Partial<NotebookEditorOptions>): NotebookEditorOptions {
		return new NotebookEditorOptions({ ...this, ...options });
	}
}

export type INotebookEditorContributionCtor = IConstructorSignature1<INotebookEditor, INotebookEditorContribution>;

export interface INotebookEditorContributionDescription {
	id: string;
	ctor: INotebookEditorContributionCtor;
}

export interface INotebookEditorCreationOptions {
	readonly isEmbedded?: boolean;
	readonly contributions?: INotebookEditorContributionDescription[];
}

export interface IActiveNotebookEditor extends INotebookEditor {
	viewModel: NotebookViewModel;
	uri: URI;
	// selection is never undefined when the editor is attached to a document.
	getSelection(): ICellRange;
}

export const NOTEBOOK_EDITOR_ID = 'workbench.editor.notebook';

export const NOTEBOOK_DIFF_EDITOR_ID = 'workbench.editor.notebookTextDiffEditor';

export interface INotebookEditor extends IEditor, ICommonNotebookEditor {
	isEmbedded: boolean;

	cursorNavigationMode: boolean;

	/**
	 * Notebook view model attached to the current editor
	 */
	viewModel: NotebookViewModel | undefined;
	hasModel(): this is IActiveNotebookEditor;

	/**
	 * An event emitted when the model of this editor has changed.
	 * @event
	 */
	readonly onDidChangeModel: Event<NotebookTextModel | undefined>;
	readonly onDidFocusEditorWidget: Event<void>;
	activeKernel: INotebookKernel | undefined;
	multipleKernelsAvailable: boolean;
	readonly onDidChangeAvailableKernels: Event<void>;
	readonly onDidChangeKernel: Event<void>;
	readonly onDidChangeActiveCell: Event<void>;
	readonly onDidScroll: Event<ScrollEvent>;
	readonly onWillDispose: Event<void>;

	isDisposed: boolean;

	getId(): string;
	getDomNode(): HTMLElement;
	getOverflowContainerDomNode(): HTMLElement;
	getInnerWebview(): Webview | undefined;
	getSelectionViewModels(): ICellViewModel[];

	/**
	 * Focus the notebook editor cell list
	 */
	focus(): void;

	hasFocus(): boolean;
	hasWebviewFocus(): boolean;

	hasOutputTextSelection(): boolean;
	setOptions(options: NotebookEditorOptions | undefined): Promise<void>;

	/**
	 * Select & focus cell
	 */
	focusElement(cell: ICellViewModel): void;

	/**
	 * Layout info for the notebook editor
	 */
	getLayoutInfo(): NotebookLayoutInfo;

	/**
	 * Fetch the output renderers for notebook outputs.
	 */
	getOutputRenderer(): OutputRenderer;

	/**
	 * Fetch the contributed kernels for this notebook
	 */
	beginComputeContributedKernels(): Promise<INotebookKernel[]>;

	/**
	 * Insert a new cell around `cell`
	 */
	insertNotebookCell(cell: ICellViewModel | undefined, type: CellKind, direction?: 'above' | 'below', initialText?: string, ui?: boolean): CellViewModel | null;

	/**
	 * Split a given cell into multiple cells of the same type using the selection start positions.
	 */
	splitNotebookCell(cell: ICellViewModel): Promise<CellViewModel[] | null>;

	/**
	 * Joins the given cell either with the cell above or the one below depending on the given direction.
	 */
	joinNotebookCells(cell: ICellViewModel, direction: 'above' | 'below', constraint?: CellKind): Promise<ICellViewModel | null>;

	/**
	 * Delete a cell from the notebook
	 */
	deleteNotebookCell(cell: ICellViewModel): Promise<boolean>;

	/**
	 * Move a cell up one spot
	 */
	moveCellUp(cell: ICellViewModel): Promise<ICellViewModel | null>;

	/**
	 * Move a cell down one spot
	 */
	moveCellDown(cell: ICellViewModel): Promise<ICellViewModel | null>;

	/**
	 * @deprecated Note that this method doesn't support batch operations, use #moveCellToIdx instead.
	 * Move a cell above or below another cell
	 */
	moveCell(cell: ICellViewModel, relativeToCell: ICellViewModel, direction: 'above' | 'below'): Promise<ICellViewModel | null>;

	/**
	 * Move a cell to a specific position
	 */
	moveCellsToIdx(index: number, length: number, toIdx: number): Promise<ICellViewModel | null>;

	/**
	 * Focus the container of a cell (the monaco editor inside is not focused).
	 */
	focusNotebookCell(cell: ICellViewModel, focus: 'editor' | 'container' | 'output'): void;

	focusNextNotebookCell(cell: ICellViewModel, focus: 'editor' | 'container' | 'output'): void;

	/**
	 * Execute the given notebook cell
	 */
	executeNotebookCell(cell: ICellViewModel): Promise<void>;

	/**
	 * Cancel the cell execution
	 */
	cancelNotebookCellExecution(cell: ICellViewModel): void;

	/**
	 * Executes all notebook cells in order
	 */
	executeNotebook(): Promise<void>;

	/**
	 * Cancel the notebook execution
	 */
	cancelNotebookExecution(): void;

	/**
	 * Get current active cell
	 */
	getActiveCell(): ICellViewModel | undefined;

	/**
	 * Layout the cell with a new height
	 */
	layoutNotebookCell(cell: ICellViewModel, height: number): Promise<void>;

	createMarkdownPreview(cell: ICellViewModel): Promise<void>;
	unhideMarkdownPreview(cell: ICellViewModel): Promise<void>;
	hideMarkdownPreview(cell: ICellViewModel): Promise<void>;
	removeMarkdownPreview(cell: ICellViewModel): Promise<void>;

	/**
	 * Render the output in webview layer
	 */
	createInset(cell: ICellViewModel, output: IInsetRenderOutput, offset: number): Promise<void>;

	/**
	 * Remove the output from the webview layer
	 */
	removeInset(output: IDisplayOutputViewModel): void;

	/**
	 * Hide the inset in the webview layer without removing it
	 */
	hideInset(output: IDisplayOutputViewModel): void;

	/**
	 * Send message to the webview for outputs.
	 */
	postMessage(forRendererId: string | undefined, message: any): void;

	/**
	 * Toggle class name on the notebook editor root DOM node.
	 */
	toggleClassName(className: string): void;

	/**
	 * Remove class name on the notebook editor root DOM node.
	 */
	addClassName(className: string): void;

	/**
	 * Remove class name on the notebook editor root DOM node.
	 */
	removeClassName(className: string): void;

	deltaCellOutputContainerClassNames(cellId: string, added: string[], removed: string[]): void;

	/**
	 * Trigger the editor to scroll from scroll event programmatically
	 */
	triggerScroll(event: IMouseWheelEvent): void;

	/**
	 * The range will be revealed with as little scrolling as possible.
	 */
	revealCellRangeInView(range: ICellRange): void;

	/**
	 * Reveal cell into viewport.
	 */
	revealInView(cell: ICellViewModel): void;

	/**
	 * Reveal cell into the top of viewport.
	 */
	revealInViewAtTop(cell: ICellViewModel): void;

	/**
	 * Reveal cell into viewport center.
	 */
	revealInCenter(cell: ICellViewModel): void;

	/**
	 * Reveal cell into viewport center if cell is currently out of the viewport.
	 */
	revealInCenterIfOutsideViewport(cell: ICellViewModel): void;

	/**
	 * Reveal a line in notebook cell into viewport with minimal scrolling.
	 */
	revealLineInViewAsync(cell: ICellViewModel, line: number): Promise<void>;

	/**
	 * Reveal a line in notebook cell into viewport center.
	 */
	revealLineInCenterAsync(cell: ICellViewModel, line: number): Promise<void>;

	/**
	 * Reveal a line in notebook cell into viewport center.
	 */
	revealLineInCenterIfOutsideViewportAsync(cell: ICellViewModel, line: number): Promise<void>;

	/**
	 * Reveal a range in notebook cell into viewport with minimal scrolling.
	 */
	revealRangeInViewAsync(cell: ICellViewModel, range: Range): Promise<void>;

	/**
	 * Reveal a range in notebook cell into viewport center.
	 */
	revealRangeInCenterAsync(cell: ICellViewModel, range: Range): Promise<void>;

	/**
	 * Reveal a range in notebook cell into viewport center.
	 */
	revealRangeInCenterIfOutsideViewportAsync(cell: ICellViewModel, range: Range): Promise<void>;

	/**
	 * Set hidden areas on cell text models.
	 */
	setHiddenAreas(_ranges: ICellRange[]): boolean;

	setCellSelection(cell: ICellViewModel, selection: Range): void;

	deltaCellDecorations(oldDecorations: string[], newDecorations: INotebookDeltaDecoration[]): string[];

	/**
	 * Change the decorations on cells.
	 * The notebook is virtualized and this method should be called to create/delete editor decorations safely.
	 */
	changeModelDecorations<T>(callback: (changeAccessor: IModelDecorationsChangeAccessor) => T): T | null;

	setEditorDecorations(key: string, range: ICellRange): void;
	removeEditorDecorations(key: string): void;

	/**
	 * An event emitted on a "mouseup".
	 * @event
	 */
	onMouseUp(listener: (e: INotebookEditorMouseEvent) => void): IDisposable;

	/**
	 * An event emitted on a "mousedown".
	 * @event
	 */
	onMouseDown(listener: (e: INotebookEditorMouseEvent) => void): IDisposable;

	/**
	 * Get a contribution of this editor.
	 * @id Unique identifier of the contribution.
	 * @return The contribution or null if contribution not found.
	 */
	getContribution<T extends INotebookEditorContribution>(id: string): T;

	getCellByInfo(cellInfo: ICommonCellInfo): ICellViewModel;
	getCellById(cellId: string): ICellViewModel | undefined;
	updateOutputHeight(cellInfo: ICommonCellInfo, output: IDisplayOutputViewModel, height: number, isInit: boolean): void;
}

export interface INotebookCellList {
	isDisposed: boolean;
	readonly contextKeyService: IContextKeyService;
	element(index: number): ICellViewModel | undefined;
	elementAt(position: number): ICellViewModel | undefined;
	elementHeight(element: ICellViewModel): number;
	onWillScroll: Event<ScrollEvent>;
	onDidScroll: Event<ScrollEvent>;
	onDidChangeFocus: Event<IListEvent<ICellViewModel>>;
	onDidChangeContentHeight: Event<number>;
	onDidChangeVisibleRanges: Event<void>;
	visibleRanges: ICellRange[];
	scrollTop: number;
	scrollHeight: number;
	scrollLeft: number;
	length: number;
	rowsContainer: HTMLElement;
	readonly onDidRemoveOutput: Event<ICellOutputViewModel>;
	readonly onDidHideOutput: Event<ICellOutputViewModel>;
	readonly onDidRemoveCellFromView: Event<ICellViewModel>;
	readonly onMouseUp: Event<IListMouseEvent<CellViewModel>>;
	readonly onMouseDown: Event<IListMouseEvent<CellViewModel>>;
	readonly onContextMenu: Event<IListContextMenuEvent<CellViewModel>>;
	detachViewModel(): void;
	attachViewModel(viewModel: NotebookViewModel): void;
	clear(): void;
	getViewIndex(cell: ICellViewModel): number | undefined;
	focusElement(element: ICellViewModel): void;
	selectElement(element: ICellViewModel): void;
	getFocusedElements(): ICellViewModel[];
	getSelectedElements(): ICellViewModel[];
	revealElementsInView(range: ICellRange): void;
	revealElementInView(element: ICellViewModel): void;
	revealElementInViewAtTop(element: ICellViewModel): void;
	revealElementInCenterIfOutsideViewport(element: ICellViewModel): void;
	revealElementInCenter(element: ICellViewModel): void;
	revealElementInCenterIfOutsideViewportAsync(element: ICellViewModel): Promise<void>;
	revealElementLineInViewAsync(element: ICellViewModel, line: number): Promise<void>;
	revealElementLineInCenterAsync(element: ICellViewModel, line: number): Promise<void>;
	revealElementLineInCenterIfOutsideViewportAsync(element: ICellViewModel, line: number): Promise<void>;
	revealElementRangeInViewAsync(element: ICellViewModel, range: Range): Promise<void>;
	revealElementRangeInCenterAsync(element: ICellViewModel, range: Range): Promise<void>;
	revealElementRangeInCenterIfOutsideViewportAsync(element: ICellViewModel, range: Range): Promise<void>;
	setHiddenAreas(_ranges: ICellRange[], triggerViewUpdate: boolean): boolean;
	domElementOfElement(element: ICellViewModel): HTMLElement | null;
	focusView(): void;
	getAbsoluteTopOfElement(element: ICellViewModel): number;
	triggerScrollFromMouseWheelEvent(browserEvent: IMouseWheelEvent): void;
	updateElementHeight2(element: ICellViewModel, size: number): void;
	domFocus(): void;
	setCellSelection(element: ICellViewModel, range: Range): void;
	style(styles: IListStyles): void;
	updateOptions(options: IListOptions<ICellViewModel>): void;
	layout(height?: number, width?: number): void;
	dispose(): void;

	// TODO@roblourens resolve differences between List<CellViewModel> and INotebookCellList<ICellViewModel>
	getFocus(): number[];
}

export interface BaseCellRenderTemplate {
	rootContainer: HTMLElement;
	editorPart: HTMLElement;
	collapsedPart: HTMLElement;
	expandButton: HTMLElement;
	contextKeyService: IContextKeyService;
	container: HTMLElement;
	cellContainer: HTMLElement;
	decorationContainer: HTMLElement;
	toolbar: ToolBar;
	deleteToolbar: ToolBar;
	betweenCellToolbar: ToolBar;
	focusIndicatorLeft: HTMLElement;
	focusIndicatorRight: HTMLElement;
	disposables: DisposableStore;
	elementDisposables: DisposableStore;
	bottomCellContainer: HTMLElement;
	currentRenderedCell?: ICellViewModel;
	statusBar: CellEditorStatusBar;
	titleMenu: IMenu;
	toJSON: () => object;
}

export interface MarkdownCellRenderTemplate extends BaseCellRenderTemplate {
	editorContainer: HTMLElement;
	foldingIndicator: HTMLElement;
	focusIndicatorBottom: HTMLElement;
	currentEditor?: ICodeEditor;
}

export interface CodeCellRenderTemplate extends BaseCellRenderTemplate {
	cellRunState: RunStateRenderer;
	runToolbar: ToolBar;
	runButtonContainer: HTMLElement;
	executionOrderLabel: HTMLElement;
	outputContainer: HTMLElement;
	outputShowMoreContainer: HTMLElement;
	focusSinkElement: HTMLElement;
	editor: ICodeEditor;
	progressBar: ProgressBar;
	timer: TimerRenderer;
	focusIndicatorRight: HTMLElement;
	focusIndicatorBottom: HTMLElement;
	dragHandle: HTMLElement;
}

export function isCodeCellRenderTemplate(templateData: BaseCellRenderTemplate): templateData is CodeCellRenderTemplate {
	return !!(templateData as CodeCellRenderTemplate).runToolbar;
}

export interface IOutputTransformContribution {
	getMimetypes(): string[];
	/**
	 * Dispose this contribution.
	 */
	dispose(): void;

	/**
	 * Returns contents to place in the webview inset, or the {@link IRenderNoOutput}.
	 * This call is allowed to have side effects, such as placing output
	 * directly into the container element.
	 */
	render(output: ICellOutputViewModel, items: IOutputItemDto[], container: HTMLElement, notebookUri: URI | undefined): IRenderOutput;
}

export interface CellFindMatch {
	cell: CellViewModel;
	matches: FindMatch[];
}

export enum CellRevealType {
	Line,
	Range
}

export enum CellRevealPosition {
	Top,
	Center
}

export enum CellEditState {
	/**
	 * Default state.
	 * For markdown cell, it's Markdown preview.
	 * For code cell, the browser focus should be on the container instead of the editor
	 */
	Preview,


	/**
	 * Eding mode. Source for markdown or code is rendered in editors and the state will be persistent.
	 */
	Editing
}

export enum CellFocusMode {
	Container,
	Editor
}

export enum CursorAtBoundary {
	None,
	Top,
	Bottom,
	Both
}

export interface CellViewModelStateChangeEvent {
	readonly metadataChanged?: boolean;
	readonly selectionChanged?: boolean;
	readonly focusModeChanged?: boolean;
	readonly editStateChanged?: boolean;
	readonly languageChanged?: boolean;
	readonly foldingStateChanged?: boolean;
	readonly contentChanged?: boolean;
	readonly outputIsHoveredChanged?: boolean;
	readonly cellIsHoveredChanged?: boolean;
}

export function cellRangesEqual(a: ICellRange[], b: ICellRange[]) {
	a = reduceCellRanges(a);
	b = reduceCellRanges(b);
	if (a.length !== b.length) {
		return false;
	}

	for (let i = 0; i < a.length; i++) {
		if (a[i].start !== b[i].start || a[i].end !== b[i].end) {
			return false;
		}
	}

	return true;
}


/**
 * @param _ranges
 */
export function reduceCellRanges(_ranges: ICellRange[]): ICellRange[] {
	if (!_ranges.length) {
		return [];
	}

	const ranges = _ranges.sort((a, b) => a.start - b.start);
	const result: ICellRange[] = [];
	let currentRangeStart = ranges[0].start;
	let currentRangeEnd = ranges[0].end + 1;

	for (let i = 0, len = ranges.length; i < len; i++) {
		const range = ranges[i];

		if (range.start > currentRangeEnd) {
			result.push({ start: currentRangeStart, end: currentRangeEnd - 1 });
			currentRangeStart = range.start;
			currentRangeEnd = range.end + 1;
		} else if (range.end + 1 > currentRangeEnd) {
			currentRangeEnd = range.end + 1;
		}
	}

	result.push({ start: currentRangeStart, end: currentRangeEnd - 1 });
	return result;
}

export function getVisibleCells(cells: CellViewModel[], hiddenRanges: ICellRange[]) {
	if (!hiddenRanges.length) {
		return cells;
	}

	let start = 0;
	let hiddenRangeIndex = 0;
	const result: CellViewModel[] = [];

	while (start < cells.length && hiddenRangeIndex < hiddenRanges.length) {
		if (start < hiddenRanges[hiddenRangeIndex].start) {
			result.push(...cells.slice(start, hiddenRanges[hiddenRangeIndex].start));
		}

		start = hiddenRanges[hiddenRangeIndex].end + 1;
		hiddenRangeIndex++;
	}

	if (start < cells.length) {
		result.push(...cells.slice(start));
	}

	return result;
}

export function getNotebookEditorFromEditorPane(editorPane?: IEditorPane): INotebookEditor | undefined {
	return editorPane?.getId() === NOTEBOOK_EDITOR_ID ? editorPane.getControl() as INotebookEditor | undefined : undefined;
}

let EDITOR_TOP_PADDING = 12;
const editorTopPaddingChangeEmitter = new Emitter<void>();

export const EditorTopPaddingChangeEvent = editorTopPaddingChangeEmitter.event;

export function updateEditorTopPadding(top: number) {
	EDITOR_TOP_PADDING = top;
	editorTopPaddingChangeEmitter.fire();
}

export function getEditorTopPadding() {
	return EDITOR_TOP_PADDING;
}
