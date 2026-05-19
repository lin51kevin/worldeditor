/**
 * CopilotPanel Integration Tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { CopilotPanel } from './CopilotPanel';
import type { ActionResult } from '../core/action-executor';

// ─── Mock engine with configurable behavior ───

const { mockHandleInput, mockAbort } = vi.hoisted(() => {
  const mockHandleInput = vi.fn().mockResolvedValue(undefined);
  const mockAbort = vi.fn();
  return { mockHandleInput, mockAbort };
});

vi.mock('../core/config-store', () => ({
  loadConfig: vi.fn().mockReturnValue({
    activeProviderId: 'ollama',
    providers: {
      ollama: { id: 'ollama', name: 'Ollama', baseUrl: '', apiKey: '', model: 'qwen2.5-coder' },
    },
    applyMode: 'manual',
    maxHistoryLength: 50,
  }),
  saveConfig: vi.fn(),
}));

vi.mock('../core/copilot-engine', () => {
  return {
    CopilotEngine: vi.fn().mockImplementation(() => ({
      handleInput: (...args: any[]) => mockHandleInput(...args),
      abort: () => mockAbort(),
      reset: vi.fn(),
      getHistory: vi.fn().mockReturnValue([]),
      configure: vi.fn(),
    })),
  };
});

vi.mock('../core/intent-parser', () => ({
  parseIntent: vi.fn(),
  getQuickCommandList: vi.fn().mockReturnValue([
    { command: '/road add [length]', label: 'Add Road', description: 'Add a new road' },
    { command: '/road delete', label: 'Delete Road', description: 'Delete selected road' },
    { command: '/help', label: 'Help', description: 'Show commands' },
  ]),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'copilot.title': 'AI 助手',
        'copilot.emptyHint': '输入问题或 / 命令开始',
        'copilot.inputPlaceholder': '输入消息...',
        'copilot.newChat': '新对话',
        'copilot.tipHint': '提示：输入 /road add 添加道路',
        'copilot.stop': '停止',
        'copilot.send': '发送',
        'copilot.applyModeAuto': '自动',
        'copilot.applyModeManual': '手动',
        'copilot.applyModeAutoTooltip': '自动应用更改',
        'copilot.applyModeManualTooltip': '手动确认更改',
        'copilot.noProvider': '未配置服务商',
      };
      return map[key] || key;
    },
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockHandleInput.mockResolvedValue(undefined);
});

// ─── Helpers ───

function renderPanel() {
  return render(<CopilotPanel />);
}

function getInput() {
  return screen.getByPlaceholderText('输入消息...') as HTMLTextAreaElement;
}

async function typeAndSubmit(text: string) {
  const input = getInput();
  fireEvent.change(input, { target: { value: text } });
  await act(async () => {});
  fireEvent.keyDown(input, { key: 'Enter', shiftKey: false });
  await act(async () => {});
}

// ─── Tests ───

describe('CopilotPanel', () => {
  it('1. 面板渲染：显示标题"AI 助手"和输入框', () => {
    renderPanel();
    expect(screen.getByText('AI 助手')).toBeInTheDocument();
    expect(getInput()).toBeInTheDocument();
  });

  it('2. 输入文本并提交：消息列表出现用户消息', async () => {
    renderPanel();
    await typeAndSubmit('你好');
    expect(screen.getByText('你好')).toBeInTheDocument();
  });

  it('3. 输入 "/" 时显示快捷命令弹窗', async () => {
    renderPanel();
    const input = getInput();
    fireEvent.change(input, { target: { value: '/' } });
    await act(async () => {});
    expect(screen.getByText('Add Road')).toBeInTheDocument();
    expect(screen.getByText('Delete Road')).toBeInTheDocument();
  });

  it('4. 选择快捷命令：输入框填入命令文本', async () => {
    renderPanel();
    const input = getInput();
    fireEvent.change(input, { target: { value: '/' } });
    await act(async () => {});
    fireEvent.click(screen.getByText('Add Road'));
    await act(async () => {});
    expect(input.value).toBe('/road add [length] ');
  });

  it('5. 本地指令执行后显示操作预览卡片（成功）', async () => {
    mockHandleInput.mockImplementation(async (_input: string, callbacks: any) => {
      const successResult: ActionResult = { success: true, description: '道路已添加' };
      callbacks.onAction(successResult);
      callbacks.onDone();
    });

    renderPanel();

    // Type and submit
    const input = getInput();
    fireEvent.change(input, { target: { value: '/road add 100' } });
    await act(async () => {});
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: false });
    // Wait for async handleSubmit to complete
    await act(async () => { await new Promise(r => setTimeout(r, 100)); });

    expect(screen.getByText('道路已添加')).toBeInTheDocument();
  });

  it('6. 本地指令执行失败显示错误卡片', async () => {
    mockHandleInput.mockImplementation(async (_input: string, callbacks: any) => {
      const failResult: ActionResult = { success: false, description: '操作失败', error: '无效参数' };
      callbacks.onAction(failResult);
      callbacks.onDone();
    });

    renderPanel();
    await typeAndSubmit('/road add abc');

    await waitFor(() => {
      expect(screen.getByText('无效参数')).toBeInTheDocument();
    });
  });

  it('7. AI 回复流式显示', async () => {
    mockHandleInput.mockImplementation(async (_input: string, callbacks: any) => {
      callbacks.onChunk('你');
      callbacks.onChunk('好');
      callbacks.onChunk('！');
      callbacks.onDone();
    });

    renderPanel();
    await typeAndSubmit('hello');

    await waitFor(() => {
      expect(screen.getByText('你好！')).toBeInTheDocument();
    });
  });

  it('8. 加载中显示打字动画', async () => {
    // handleInput never resolves → stays loading
    mockHandleInput.mockImplementation(async () => {
      await new Promise(() => {}); // never resolves
    });

    renderPanel();
    fireEvent.change(getInput(), { target: { value: 'test' } });
    await act(async () => {});
    fireEvent.keyDown(getInput(), { key: 'Enter', shiftKey: false });
    await act(async () => {});

    expect(screen.getByTestId('typing-indicator')).toBeInTheDocument();
  });

  it('9. Enter 发送、Shift+Enter 换行', async () => {
    renderPanel();
    const input = getInput();

    // Shift+Enter should add newline
    fireEvent.change(input, { target: { value: 'line1' } });
    await act(async () => {});
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    await act(async () => {});
    expect(input.value).toBe('line1\n');

    // Enter should submit and clear
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: false });
    await act(async () => {});
    expect(input.value).toBe('');
    expect(screen.getByText('line1')).toBeInTheDocument();
  });

  it('10. Escape 取消请求', async () => {
    mockHandleInput.mockImplementation(async () => {
      await new Promise(() => {}); // never resolves
    });

    renderPanel();
    fireEvent.change(getInput(), { target: { value: 'long query' } });
    await act(async () => {});
    fireEvent.keyDown(getInput(), { key: 'Enter', shiftKey: false });
    await act(async () => {});

    fireEvent.keyDown(getInput(), { key: 'Escape' });
    await act(async () => {});

    expect(mockAbort).toHaveBeenCalled();
  });

  it('11. 新对话按钮：清空消息历史', async () => {
    mockHandleInput.mockImplementation(async (_: string, callbacks: any) => {
      callbacks.onChunk('response');
      callbacks.onDone();
    });

    renderPanel();
    await typeAndSubmit('test');

    await waitFor(() => {
      expect(screen.getByText('test')).toBeInTheDocument();
    });

    const newChatBtn = screen.getByTitle('新对话');
    await act(async () => { fireEvent.click(newChatBtn); });

    expect(screen.queryByText('test')).not.toBeInTheDocument();
  });

  it('12. 应用模式徽标：显示当前模式并可切换', async () => {
    renderPanel();
    const badge = screen.getByText('手动');
    expect(badge).toBeInTheDocument();

    await act(async () => { fireEvent.click(badge); });
    expect(screen.getByText('自动')).toBeInTheDocument();
  });

  it('13. 空对话时显示提示行', () => {
    renderPanel();
    expect(screen.getByText('提示：输入 /road add 添加道路')).toBeInTheDocument();
  });

  it('14. 提示行在有消息时隐藏', async () => {
    mockHandleInput.mockImplementation(async (_: string, callbacks: any) => {
      callbacks.onChunk('ok');
      callbacks.onDone();
    });

    renderPanel();
    await typeAndSubmit('hello');

    await waitFor(() => {
      expect(screen.queryByText('提示：输入 /road add 添加道路')).not.toBeInTheDocument();
    });
  });
});
