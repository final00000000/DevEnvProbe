# DevEnvProbe 代码架构重构 - 测试文档

## 📊 测试覆盖率目标

- **状态管理层 (state/)**: 100% 覆盖
- **服务层 (services/)**: 90%+ 覆盖
- **页面层 (pages/)**: 80%+ 覆盖
- **核心功能 (core/)**: 95%+ 覆盖
- **UI 组件 (ui/)**: 85%+ 覆盖

## 🧪 已创建的单元测试

### 1. `system-state.test.ts`
**测试范围**：
- ✅ 初始化状态验证
- ✅ `updateUptimeAnchor()` - 运行时长锚点更新
- ✅ `getAnchoredUptimeSeconds()` - 计算锚定运行时长
- ✅ `clearAllTimers()` - 定时器清理

**测试用例数**: 11 个

### 2. `tools-state.test.ts`
**测试范围**:
- ✅ 初始化状态验证
- ✅ `appendLog()` - 日志追加
- ✅ `updateCategories()` - 分类提取和排序
- ✅ `getToolIdentity()` - 工具唯一标识生成
- ✅ `clearAllTimers()` - 定时器清理

**测试用例数**: 13 个

### 3. `app-state.test.ts`
**测试范围**:
- ✅ 初始化状态验证
- ✅ `incrementRenderEpoch()` - 渲染版本号递增
- ✅ `isRenderStale()` - 渲染过期检查
- ✅ `cachePageRoot()` - 页面 DOM 缓存
- ✅ `restoreCachedPageRoot()` - 恢复缓存 DOM

**测试用例数**: 14 个

---

## 🚀 运行测试

### 安装测试依赖
```bash
cd tests
npm install
```

### 运行所有测试
```bash
npm test
```

### 运行单元测试（监听模式）
```bash
npm run test:watch
```

### 生成覆盖率报告
```bash
npm run test:coverage
```

覆盖率报告将生成在 `coverage/` 目录：
- `coverage/index.html` - HTML 可视化报告
- `coverage/coverage-final.json` - JSON 格式报告

---

## 📝 测试策略

### 1. **状态管理层测试**
- 验证初始化状态
- 测试状态变更方法
- 验证边界条件（空值、负数、极限值）
- 测试定时器清理逻辑

### 2. **服务层测试**（待实现）
- Mock Tauri invoke 调用
- 验证数据转换逻辑
- 测试错误处理
- 验证缓存机制

### 3. **页面层测试**（待实现）
- 验证 HTML 渲染输出
- 测试事件绑定
- 验证条件渲染逻辑
- 测试数据筛选功能

### 4. **核心功能测试**（待实现）
- 测试导航逻辑
- 验证生命周期钩子
- 测试页面缓存机制

---

## ✅ 测试最佳实践

### 1. **命名规范**
```typescript
describe('模块名', () => {
  describe('方法名()', () => {
    it('应该执行预期行为', () => {
      // 测试逻辑
    });
  });
});
```

### 2. **AAA 模式**（Arrange-Act-Assert）
```typescript
it('应该正确更新状态', () => {
  // Arrange - 准备测试数据
  const state = new SystemState();

  // Act - 执行操作
  state.updateUptimeAnchor(1000);

  // Assert - 验证结果
  expect(state.uptimeAnchorSeconds).toBe(1000);
});
```

### 3. **使用 beforeEach 和 afterEach**
```typescript
beforeEach(() => {
  // 每个测试前初始化
  state = new SystemState();
  vi.useFakeTimers();
});

afterEach(() => {
  // 每个测试后清理
  vi.restoreAllMocks();
  vi.useRealTimers();
});
```

### 4. **边界条件测试**
- 空值/null/undefined
- 负数
- 极大/极小值
- 空数组/空对象

---

## 🎯 下一步测试任务

### 优先级 1（核心功能）
- [ ] `docker-state.test.ts`
- [ ] `system-service.test.ts`
- [ ] `tools-service.test.ts`
- [ ] `docker-service.test.ts`

### 优先级 2（UI 组件）
- [ ] `metric-card.test.ts`
- [ ] `docker-components.test.ts`

### 优先级 3（页面渲染）
- [ ] `SystemPage.test.ts`
- [ ] `ToolsPage.test.ts`
- [ ] `DockerPage.test.ts`

### 优先级 4（核心模块）
- [ ] `navigation.test.ts`
- [ ] `lifecycle.test.ts`

---

## 📈 当前测试统计

| 模块 | 测试文件 | 测试用例 | 覆盖率 |
|------|---------|---------|--------|
| **state/** | 3 | 38 | ~100% |
| **services/** | 0 | 0 | 0% |
| **pages/** | 0 | 0 | 0% |
| **core/** | 0 | 0 | 0% |
| **ui/** | 0 | 0 | 0% |
| **总计** | 3 | 38 | ~25% |

---

## 🔧 Mock 工具和技巧

### Mock Tauri invoke
```typescript
import { vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

// 在测试中
import { invoke } from '@tauri-apps/api/core';
(invoke as any).mockResolvedValue({
  ok: true,
  data: mockData,
  error: null,
  elapsedMs: 100,
});
```

### Mock setTimeout/setInterval
```typescript
beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// 在测试中
vi.advanceTimersByTime(1000); // 前进 1 秒
```

### Mock DOM
```typescript
const mockElement = document.createElement('div');
mockElement.id = 'test-id';
document.body.appendChild(mockElement);

// 测试后清理
afterEach(() => {
  document.body.innerHTML = '';
});
```

---

## 📚 参考资源

- [Vitest 官方文档](https://vitest.dev/)
- [Testing Library](https://testing-library.com/)
- [Jest Mock Functions](https://jestjs.io/docs/mock-functions)
