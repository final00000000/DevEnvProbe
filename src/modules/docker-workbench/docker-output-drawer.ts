import { escapeHtml } from "../../utils/formatters";

export interface DockerOutputDrawerOptions {
  open: boolean;
  status: string;
  output: string;
  lastCommand: string;
}

export function renderDockerOutputDrawer(options: DockerOutputDrawerOptions): string {
  return `
    <aside class="docker-workbench-output-drawer ${options.open ? "is-open" : ""}" id="docker-output-drawer" aria-hidden="${
      options.open ? "false" : "true"
    }">
      <div class="docker-workbench-output-head">
        <div>
          <div class="text-xs text-text-muted">命令输出</div>
          <div class="text-sm text-text-primary">${escapeHtml(options.status)}</div>
        </div>
        <button type="button" class="btn btn-secondary btn-xs" data-docker-drawer-close>收起</button>
      </div>
      <div class="docker-workbench-output-meta text-xs text-text-muted">${escapeHtml(options.lastCommand || "尚未执行")}</div>
      <pre id="docker-output" class="docker-output custom-scrollbar">${escapeHtml(options.output)}</pre>
    </aside>
  `;
}

export function shouldAutoOpenDockerOutputDrawer(action: string, exitCode: number): boolean {
  if (action === "logs") {
    return true;
  }

  return exitCode !== 0;
}
