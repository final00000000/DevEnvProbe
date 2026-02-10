import { beforeEach, describe, expect, it } from 'vitest';
import { applyTheme, getEffectiveTheme } from '../../src/modules/theme/theme-engine';
import { renderThemeSettingsPanel, bindThemeSettingsPanel } from '../../src/modules/theme/theme-settings';
import { getThemeDefinitions } from '../../src/modules/theme/theme-registry';
import {
  COLOR_THEME_STORAGE_KEY,
  LEGACY_THEME_STORAGE_KEY,
  loadPersistedTheme,
  migrateLegacyThemeState,
  saveTheme,
} from '../../src/modules/theme/theme-storage';

describe('theme-domain', () => {
  beforeEach(() => {
    document.documentElement.className = '';
    document.documentElement.removeAttribute('data-theme');
    localStorage.clear();
    document.body.innerHTML = '';
  });

  it('migrateLegacyThemeState 应清理旧浅色模式痕迹', () => {
    document.documentElement.classList.add('light');
    localStorage.setItem(LEGACY_THEME_STORAGE_KEY, 'light');

    migrateLegacyThemeState();

    expect(document.documentElement.classList.contains('light')).toBe(false);
    expect(localStorage.getItem(LEGACY_THEME_STORAGE_KEY)).toBeNull();
  });

  it('loadPersistedTheme 应处理默认值与非法值', () => {
    expect(loadPersistedTheme()).toBe('github');

    localStorage.setItem(COLOR_THEME_STORAGE_KEY, 'invalid-theme');
    expect(loadPersistedTheme()).toBe('github');

    localStorage.setItem(COLOR_THEME_STORAGE_KEY, 'linear');
    expect(loadPersistedTheme()).toBe('linear');
  });

  it('applyTheme 应正确切换 data-theme', () => {
    applyTheme('github');
    expect(document.documentElement.getAttribute('data-theme')).toBeNull();
    expect(getEffectiveTheme()).toBe('github');

    applyTheme('arc');
    expect(document.documentElement.getAttribute('data-theme')).toBe('arc');
    expect(getEffectiveTheme()).toBe('arc');

    applyTheme('white');
    expect(document.documentElement.getAttribute('data-theme')).toBe('white');
    expect(getEffectiveTheme()).toBe('white');
  });

  it('主题设置面板点击后应同步主题和状态', () => {
    applyTheme('github');
    saveTheme('github');

    document.body.innerHTML = renderThemeSettingsPanel();
    bindThemeSettingsPanel(document);

    const option = document.querySelector<HTMLElement>('.theme-option[data-theme="white"]');
    expect(option).not.toBeNull();

    option?.click();

    expect(document.documentElement.getAttribute('data-theme')).toBe('white');
    expect(localStorage.getItem(COLOR_THEME_STORAGE_KEY)).toBe('white');

    const activeOptions = document.querySelectorAll('.theme-option.active');
    expect(activeOptions).toHaveLength(1);
    expect((activeOptions.item(0) as HTMLElement).dataset.theme).toBe('white');

    const currentName = document.querySelector('[data-current-theme-name]')?.textContent;
    expect(currentName).toContain('白昼');
  });

  it('主题定义和设置面板应包含 6 个主题选项', () => {
    expect(getThemeDefinitions()).toHaveLength(6);

    document.body.innerHTML = renderThemeSettingsPanel();
    expect(document.querySelectorAll('.theme-option')).toHaveLength(6);
  });
});
