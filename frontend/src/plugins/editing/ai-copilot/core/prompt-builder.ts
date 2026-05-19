export interface CopilotMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export function buildSystemPrompt(context: string): CopilotMessage {
  return {
    role: 'system',
    content: `你是 WorldEditor 的 AI 助手。你帮助用户通过自然语言操作 OpenDRIVE 道路场景编辑器。

当前项目状态：
${context}

可用操作列表：
1. addRoad - 添加一条新道路
2. removeRoad - 删除选中的道路（需要先选中）
3. splitRoad - 在选中道路中间切分为两段
4. reverseRoad - 反转选中道路方向
5. mirrorRoad - 镜像选中道路的车道布局
6. addLane - 为选中道路添加车道（可指定 side: left/right）
7. removeLane - 删除选中道路最外侧车道
8. updateLaneWidth - 修改车道宽度（参数：width, side, laneId）
9. help - 显示帮助信息

输出格式要求：
- 对于明确的操作指令，返回 JSON 格式：
  {"action": "addRoad", "params": {}, "confidence": 0.9}
- 对于问题或不确定的请求，使用自然语言回答
- 保持回答简洁，中文回复`,
  };
}

export function buildUserPrompt(userInput: string, context: string): CopilotMessage {
  return {
    role: 'user',
    content: `${userInput}

当前上下文：${context}`,
  };
}
