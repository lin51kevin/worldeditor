import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ChatMessage } from './ChatMessage';

describe('ChatMessage', () => {
  it('renders a user message', () => {
    render(<ChatMessage message={{ role: 'user', content: '用户消息' }} />);

    const bubble = screen.getByText('用户消息');
    expect(bubble).toBeInTheDocument();
    expect(bubble).toHaveClass('copilot-msg-user');
    expect(bubble.parentElement).toHaveClass('copilot-msg-wrap--user');
  });

  it('renders an assistant message', () => {
    render(<ChatMessage message={{ role: 'assistant', content: '助手回复' }} />);

    const bubble = screen.getByText('助手回复');
    expect(bubble).toBeInTheDocument();
    expect(bubble).toHaveClass('copilot-msg-assistant');
    expect(bubble.parentElement).toHaveClass('copilot-msg-wrap--assistant');
  });

  it('applies different styles for user and assistant roles', () => {
    render(
      <>
        <ChatMessage message={{ role: 'user', content: '用户' }} />
        <ChatMessage message={{ role: 'assistant', content: '助手' }} />
      </>
    );

    const userBubble = screen.getByText('用户');
    const assistantBubble = screen.getByText('助手');

    expect(userBubble).toHaveClass('copilot-msg-user');
    expect(assistantBubble).toHaveClass('copilot-msg-assistant');
    expect(userBubble.parentElement).not.toHaveClass('copilot-msg-wrap--assistant');
    expect(assistantBubble.parentElement).not.toHaveClass('copilot-msg-wrap--user');
  });
});
