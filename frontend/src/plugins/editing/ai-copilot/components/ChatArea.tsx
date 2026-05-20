/**
 * ChatArea — 消息列表 + 自动滚动 + 打字动画
 */
import { useEffect, useMemo, useRef } from 'react';
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
  const idCounter = useRef(0);
  const keyMap = useMemo(() => {
    const map = new Map<ChatMessageData, number>();
    for (const msg of messages) {
      if (!map.has(msg)) {
        map.set(msg, ++idCounter.current);
      }
    }
    return map;
  }, [messages]);

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
      {messages.map((msg) => (
        <ChatMessage key={keyMap.get(msg)!} message={msg} />
      ))}
      {isLoading && messages[messages.length - 1]?.role !== 'assistant' && <TypingIndicator />}
      <div ref={bottomRef} />
    </div>
  );
}
