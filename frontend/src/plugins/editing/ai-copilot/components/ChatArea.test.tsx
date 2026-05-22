import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatArea } from './ChatArea';
import type { ChatMessageData } from './ChatMessage';

const messages: ChatMessageData[] = [
  { role: 'user', content: '你好' },
  { role: 'assistant', content: '你好，请问需要什么帮助？' },
];

describe('ChatArea', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('renders the empty state when there are no messages', () => {
    render(<ChatArea messages={[]} isLoading={false} emptyText="开始对话" />);

    expect(screen.getByText('开始对话')).toBeInTheDocument();
  });

  it('renders chat messages', () => {
    render(<ChatArea messages={messages} isLoading={false} />);

    expect(screen.getByText('你好')).toBeInTheDocument();
    expect(screen.getByText('你好，请问需要什么帮助？')).toBeInTheDocument();
    expect(screen.queryByText('输入消息开始对话')).not.toBeInTheDocument();
  });

  it('scrolls to the bottom when messages change', () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;

    const { rerender } = render(
      <ChatArea messages={[messages[0]!]} isLoading={false} />,
    );

    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    rerender(<ChatArea messages={messages} isLoading={true} />);

    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });
});
