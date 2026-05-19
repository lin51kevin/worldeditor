/**
 * ChatMessage — 单条消息气泡
 */
export interface ChatMessageData {
  role: 'user' | 'assistant';
  content: string;
}

interface Props {
  message: ChatMessageData;
}

export function ChatMessage({ message }: Props) {
  const isUser = message.role === 'user';

  return (
    <div className={`copilot-msg-wrap ${isUser ? 'copilot-msg-wrap--user' : 'copilot-msg-wrap--assistant'}`}>
      <div className={isUser ? 'copilot-msg-user' : 'copilot-msg-assistant'}>
        {message.content}
      </div>
    </div>
  );
}
