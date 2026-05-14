import * as vscode from "vscode";
import { BasketService, createSourceRangeTarget } from "./basket";

const SELECTION_DEBOUNCE_MS = 450;
const HIGHLIGHT_DECORATION = vscode.window.createTextEditorDecorationType({
  backgroundColor: new vscode.ThemeColor("editor.selectionHighlightBackground"),
  border: "1px solid",
  borderColor: new vscode.ThemeColor("editor.selectionHighlightBorder"),
  overviewRulerColor: new vscode.ThemeColor("editorOverviewRuler.findMatchForeground"),
  overviewRulerLane: vscode.OverviewRulerLane.Right,
});

export class AnnotationModeController implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private statusBar: vscode.StatusBarItem;
  private pending = new Map<vscode.TextEditor, NodeJS.Timeout>();
  private readonly decorations = new Map<vscode.TextEditor, vscode.Range[]>();

  constructor(private readonly basket: BasketService) {
    this.statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 89);
    this.statusBar.command = "hackl.toggleAnnotationMode";
    this.refreshStatus();
    this.statusBar.show();
    this.disposables.push(this.statusBar);
    this.disposables.push(
      this.basket.onDidChange(() => {
        this.refreshStatus();
        this.refreshDecorations();
      }),
      vscode.window.onDidChangeTextEditorSelection((event) => this.onSelectionChanged(event)),
      vscode.window.onDidChangeActiveTextEditor(() => this.refreshDecorations()),
      vscode.workspace.onDidChangeTextDocument(() => this.refreshDecorations()),
    );
    void vscode.commands.executeCommand("setContext", "hackl.annotationMode", this.basket.isAnnotationMode());
    this.refreshDecorations();
  }

  toggle(): void {
    const next = !this.basket.isAnnotationMode();
    this.basket.setAnnotationMode(next);
    void vscode.commands.executeCommand("setContext", "hackl.annotationMode", next);
    if (next) {
      vscode.window.setStatusBarMessage("Hackl annotation mode on — selections auto-add to basket.", 2500);
    } else {
      vscode.window.setStatusBarMessage("Hackl annotation mode off.", 1500);
    }
    this.refreshStatus();
  }

  private onSelectionChanged(event: vscode.TextEditorSelectionChangeEvent): void {
    if (!this.basket.isAnnotationMode()) return;
    const editor = event.textEditor;
    if (editor.document.uri.scheme !== "file") return;
    if (editor.selection.isEmpty) return;
    const previous = this.pending.get(editor);
    if (previous) clearTimeout(previous);
    const timer = setTimeout(() => {
      this.pending.delete(editor);
      this.addSelection(editor);
    }, SELECTION_DEBOUNCE_MS);
    this.pending.set(editor, timer);
  }

  private addSelection(editor: vscode.TextEditor): void {
    if (!this.basket.isAnnotationMode()) return;
    if (editor.selection.isEmpty) return;
    const target = createSourceRangeTarget(editor);
    if (!target) return;
    this.basket.add(target);
  }

  private refreshStatus(): void {
    const on = this.basket.isAnnotationMode();
    const count = this.basket.list().length;
    this.statusBar.text = on
      ? `$(pencil) Hackl: Annotate (${count})`
      : `$(circle-large-outline) Hackl: Annotate off`;
    this.statusBar.tooltip = on
      ? "Annotation mode on. Click to toggle. Selections auto-add to the basket."
      : "Annotation mode off. Click to toggle on.";
    this.statusBar.backgroundColor = on
      ? new vscode.ThemeColor("statusBarItem.warningBackground")
      : undefined;
  }

  private refreshDecorations(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      const ranges: vscode.Range[] = [];
      for (const target of this.basket.list()) {
        if (target.kind !== "source-range" && target.kind !== "markdown-section") continue;
        if (target.uri !== editor.document.uri.toString()) continue;
        const range = new vscode.Range(
          Math.max(0, target.startLine - 1),
          target.kind === "source-range" ? Math.max(0, target.startCharacter - 1) : 0,
          Math.max(0, target.endLine - 1),
          target.kind === "source-range" ? Math.max(0, target.endCharacter - 1) : editor.document.lineAt(Math.max(0, Math.min(target.endLine - 1, editor.document.lineCount - 1))).text.length,
        );
        ranges.push(range);
      }
      editor.setDecorations(HIGHLIGHT_DECORATION, ranges);
      this.decorations.set(editor, ranges);
    }
  }

  dispose(): void {
    for (const timer of this.pending.values()) clearTimeout(timer);
    this.pending.clear();
    for (const editor of vscode.window.visibleTextEditors) {
      editor.setDecorations(HIGHLIGHT_DECORATION, []);
    }
    HIGHLIGHT_DECORATION.dispose();
    for (const disposable of this.disposables) disposable.dispose();
  }
}
