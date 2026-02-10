import type { DeployPipelineState, DeployProfile } from "../../types";
import { escapeHtml } from "../../utils/formatters";
import { DEPLOY_STEP_LABEL } from "./deploy-types";

function renderProfileSelect(profiles: DeployProfile[], selectedProfileId: string): string {
  const options = profiles
    .map((profile) => {
      const selected = profile.id === selectedProfileId ? "selected" : "";
      return `<option value="${escapeHtml(profile.id)}" ${selected}>${escapeHtml(profile.name)}</option>`;
    })
    .join("");

  return `
    <label class="deploy-field">
      <span class="deploy-field-label">部署配置</span>
      <select class="input" data-deploy-input="selectedProfileId">${options}</select>
    </label>
  `;
}

function renderStepList(pipeline: DeployPipelineState): string {
  return `
    <ol class="deploy-step-list">
      ${pipeline.steps
        .map((item) => {
          return `
            <li class="deploy-step-item is-${item.status}">
              <div class="deploy-step-title">${escapeHtml(DEPLOY_STEP_LABEL[item.step])}</div>
              <div class="deploy-step-message">${escapeHtml(item.message)}</div>
            </li>
          `;
        })
        .join("")}
    </ol>
  `;
}

function renderDirectoryField(profile: DeployProfile): string {
  if (profile.mode === "compose") {
    return `
      <div class="deploy-field-row deploy-directory-row">
        <label class="deploy-field">
          <span class="deploy-field-label">项目目录（必填）</span>
          <input class="input" data-deploy-field="compose.projectPath" value="${escapeHtml(profile.compose.projectPath)}" placeholder="D:/workspace/my-app" />
        </label>
        <button type="button" class="btn btn-secondary btn-xs" data-deploy-action="choose-compose-project-dir">选择目录</button>
      </div>
    `;
  }

  return `
    <div class="deploy-field-row deploy-directory-row">
      <label class="deploy-field">
        <span class="deploy-field-label">项目目录（构建时必填）</span>
        <input class="input" data-deploy-field="run.buildContext" value="${escapeHtml(profile.run.buildContext)}" placeholder="D:/workspace/my-app" />
      </label>
      <button type="button" class="btn btn-secondary btn-xs" data-deploy-action="choose-run-build-dir">选择目录</button>
    </div>
  `;
}

function renderAdvancedSection(profile: DeployProfile, expanded: boolean): string {
  const composeAdvanced = `
    <div class="deploy-subsection ${profile.mode === "compose" ? "" : "hidden"}" data-deploy-mode-section="compose">
      <label class="deploy-field">
        <span class="deploy-field-label">Compose 文件</span>
        <input class="input" data-deploy-field="compose.composeFile" value="${escapeHtml(profile.compose.composeFile)}" placeholder="docker-compose.yml" />
      </label>
      <label class="deploy-field">
        <span class="deploy-field-label">服务名（可选）</span>
        <input class="input" data-deploy-field="compose.service" value="${escapeHtml(profile.compose.service)}" placeholder="留空表示全量服务" />
      </label>
    </div>
  `;

  const runAdvanced = `
    <div class="deploy-subsection ${profile.mode === "run" ? "" : "hidden"}" data-deploy-mode-section="run">
      <label class="deploy-field">
        <span class="deploy-field-label">容器名称</span>
        <input class="input" data-deploy-field="run.containerName" value="${escapeHtml(profile.run.containerName)}" placeholder="my-app" />
      </label>
      <div class="deploy-field-row">
        <label class="deploy-field">
          <span class="deploy-field-label">镜像来源</span>
          <select class="input" data-deploy-field="run.imageSource">
            <option value="pull" ${profile.run.imageSource === "pull" ? "selected" : ""}>拉取镜像</option>
            <option value="build" ${profile.run.imageSource === "build" ? "selected" : ""}>本地构建</option>
          </select>
        </label>
        <label class="deploy-field">
          <span class="deploy-field-label">参数模式</span>
          <select class="input" data-deploy-field="run.paramMode">
            <option value="form" ${profile.run.paramMode === "form" ? "selected" : ""}>表单参数</option>
            <option value="template" ${profile.run.paramMode === "template" ? "selected" : ""}>高级模板</option>
          </select>
        </label>
      </div>

      <div class="deploy-subsection ${profile.run.imageSource === "pull" ? "" : "hidden"}" data-deploy-image-source="pull">
        <label class="deploy-field">
          <span class="deploy-field-label">镜像引用</span>
          <input class="input" data-deploy-field="run.imageRef" value="${escapeHtml(profile.run.imageRef)}" placeholder="nginx:latest" />
        </label>
      </div>

      <div class="deploy-subsection ${profile.run.imageSource === "build" ? "" : "hidden"}" data-deploy-image-source="build">
        <div class="deploy-field-row">
          <label class="deploy-field">
            <span class="deploy-field-label">Dockerfile</span>
            <input class="input" data-deploy-field="run.dockerfile" value="${escapeHtml(profile.run.dockerfile)}" placeholder="Dockerfile" />
          </label>
          <label class="deploy-field">
            <span class="deploy-field-label">镜像 Tag</span>
            <input class="input" data-deploy-field="run.imageTag" value="${escapeHtml(profile.run.imageTag)}" placeholder="my-app:latest" />
          </label>
        </div>
      </div>

      <div class="deploy-subsection ${profile.run.paramMode === "form" ? "" : "hidden"}" data-deploy-param-mode="form">
        <label class="deploy-field">
          <span class="deploy-field-label">端口映射（每行一个）</span>
          <textarea class="input deploy-textarea" data-deploy-field="run.portsText" placeholder="8080:8080">${escapeHtml(profile.run.portsText)}</textarea>
        </label>
        <label class="deploy-field">
          <span class="deploy-field-label">环境变量（每行一个）</span>
          <textarea class="input deploy-textarea" data-deploy-field="run.envText" placeholder="NODE_ENV=production">${escapeHtml(profile.run.envText)}</textarea>
        </label>
        <label class="deploy-field">
          <span class="deploy-field-label">卷映射（每行一个）</span>
          <textarea class="input deploy-textarea" data-deploy-field="run.volumesText" placeholder="./data:/app/data:rw">${escapeHtml(profile.run.volumesText)}</textarea>
        </label>
        <div class="deploy-field-row">
          <label class="deploy-field">
            <span class="deploy-field-label">重启策略</span>
            <input class="input" data-deploy-field="run.restartPolicy" value="${escapeHtml(profile.run.restartPolicy)}" placeholder="unless-stopped" />
          </label>
          <label class="deploy-field">
            <span class="deploy-field-label">附加参数</span>
            <input class="input" data-deploy-field="run.extraArgs" value="${escapeHtml(profile.run.extraArgs)}" placeholder="--network bridge" />
          </label>
        </div>
      </div>

      <div class="deploy-subsection ${profile.run.paramMode === "template" ? "" : "hidden"}" data-deploy-param-mode="template">
        <div class="deploy-warning">高级模板必须包含 <code>{{IMAGE}}</code> 与 <code>{{CONTAINER}}</code> 占位符。</div>
        <label class="deploy-field">
          <span class="deploy-field-label">模板参数</span>
          <textarea class="input deploy-textarea" data-deploy-field="run.templateArgs" placeholder="-d --name {{CONTAINER}} -p 8080:8080 {{IMAGE}}">${escapeHtml(profile.run.templateArgs)}</textarea>
        </label>
      </div>
    </div>
  `;

  return `
    <div class="deploy-advanced-wrapper">
      <button type="button" class="btn btn-secondary btn-xs" data-deploy-action="toggle-advanced-config">${expanded ? "收起高级设置" : "展开高级设置"}</button>
      <div class="deploy-advanced-panel ${expanded ? "" : "hidden"}">
        ${composeAdvanced}
        ${runAdvanced}
      </div>
    </div>
  `;
}

export function renderDeployPipelineCard(
  profiles: DeployProfile[],
  selectedProfileId: string,
  selectedBranch: string,
  branches: string[],
  branchesLoading: boolean,
  pipeline: DeployPipelineState,
  branchError: string | null,
  advancedConfigExpanded: boolean
): string {
  const profile = profiles.find((item) => item.id === selectedProfileId) ?? profiles[0];
  if (!profile) {
    return "";
  }

  const branchOptions = branches
    .map((item) => `<option value="${escapeHtml(item)}" ${item === selectedBranch ? "selected" : ""}>${escapeHtml(item)}</option>`)
    .join("");

  const branchPlaceholder = branchOptions.length > 0
    ? ""
    : `<option value="">${branchesLoading ? "加载分支中..." : "暂无分支，请点击刷新"}</option>`;

  const showGitFields = profile.git.enabled;

  return `
    <div class="card deploy-pipeline-card" id="deploy-pipeline-card">
      <div class="deploy-header">
        <div>
          <h3 class="text-lg font-semibold text-text-primary">一键部署流水线</h3>
          <p class="deploy-subtitle">仅拉取代码不会自动更新容器，点击【执行部署】才会更新 Docker 运行实例。</p>
        </div>
        <div class="deploy-header-actions">
          <button type="button" class="btn btn-secondary btn-xs" data-deploy-action="add-profile">新增配置</button>
          <button type="button" class="btn btn-secondary btn-xs" data-deploy-action="save-profile">保存配置</button>
          <button type="button" class="btn btn-secondary btn-xs" data-deploy-action="delete-profile" ${profiles.length <= 1 ? "disabled" : ""}>删除配置</button>
        </div>
      </div>

      <div class="deploy-layout deploy-layout-simple">
        <section class="deploy-config-panel">
          ${renderProfileSelect(profiles, profile.id)}
          <label class="deploy-field">
            <span class="deploy-field-label">配置名称</span>
            <input class="input" data-deploy-field="name" value="${escapeHtml(profile.name)}" />
          </label>

          <div class="deploy-field-row">
            <label class="deploy-field">
              <span class="deploy-field-label">部署模式</span>
              <select class="input" data-deploy-field="mode">
                <option value="compose" ${profile.mode === "compose" ? "selected" : ""}>Compose</option>
                <option value="run" ${profile.mode === "run" ? "selected" : ""}>Run</option>
              </select>
            </label>
            <label class="deploy-field deploy-checkbox">
              <input type="checkbox" data-deploy-field="git.enabled" ${profile.git.enabled ? "checked" : ""} />
              <span>执行前拉取代码</span>
            </label>
          </div>

          ${renderDirectoryField(profile)}

          <div class="deploy-subsection ${showGitFields ? "" : "hidden"}">
            <div class="deploy-field-row">
              <label class="deploy-field">
                <span class="deploy-field-label">Git Remote</span>
                <input class="input" data-deploy-field="git.remote" value="${escapeHtml(profile.git.remote)}" placeholder="origin" />
              </label>
              <label class="deploy-field">
                <span class="deploy-field-label">目标分支</span>
                <select class="input" data-deploy-input="selectedBranch">${branchPlaceholder}${branchOptions}</select>
              </label>
            </div>
            <div class="deploy-inline-actions">
              <button type="button" class="btn btn-secondary btn-xs" data-deploy-action="refresh-branches" ${branchesLoading ? "disabled" : ""}>${branchesLoading ? "分支加载中..." : "刷新分支"}</button>
            </div>
          </div>

          ${branchError ? `<div class="deploy-inline-error">${escapeHtml(branchError)}</div>` : ""}

          ${profile.mode === "run" ? '<div class="deploy-inline-warning">Run 模式会先删除同名旧容器，再拉取/构建并启动新容器。执行前会弹窗确认。</div>' : ""}

          ${renderAdvancedSection(profile, advancedConfigExpanded)}
        </section>

        <section class="deploy-runtime-panel">
          <div class="deploy-runtime-title">执行流程</div>
          ${renderStepList(pipeline)}

          <div class="deploy-runtime-actions">
            <button type="button" class="btn btn-primary" data-deploy-action="run-pipeline" ${pipeline.running ? "disabled" : ""}>${pipeline.running ? "自动部署执行中..." : "一键自动部署"}</button>
            <button type="button" class="btn btn-secondary" data-deploy-action="view-log" ${pipeline.logs.length === 0 ? "disabled" : ""}>查看部署日志</button>
          </div>

          <div class="deploy-runtime-summary ${pipeline.lastError ? "is-error" : ""}">
            ${escapeHtml(pipeline.lastError ? `失败：${pipeline.lastError}` : pipeline.summary || "等待执行部署流程")}
          </div>
        </section>
      </div>
    </div>
  `;
}
