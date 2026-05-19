/**
 * ChatArea — 消息列表 + 自动滚动 + 打字动画
 */
import { useEffect, useRef } from 'react';
import { ChatMessage, type ChatMessageData } from './ChatMessage';

interface Props {
  messages: ChatMessageData[];
  isLoading: boolean;
  emptyText?: string;
}

function TypingIndicator() {
  return (
    <div data-testid="typing-indicator" className="copilot-typing">
      <span className="copilot-typing-dot">
        <span>.</span>
        <span>.</span>
        <span>.</span>
      </span>
    </div>
  );
}

export function ChatArea({ messages, isLoading, emptyText }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView?.({ behavior: 'smooth' });
  }, [messages, isLoading]);

  return (
    <div className="copilot-messages">
      {messages.length === 0 && !isLoading && (
        <div className="copilot-empty-hint">
          {emptyText || '输入消息开始对话'}
        </div>
      )}
      {messages.map((msg, i) => (
        <ChatMessage key={i} message={msg} />
      ))}
      {isLoading && messages[messages.length - 1]?.role !== 'assistant' && <TypingIndicator />}
      <div ref={bottomRef} />
    </div>
  );
}
