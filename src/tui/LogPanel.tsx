import React from "react";
import { Box, Text } from "ink";
import type { LogEntry } from "../ipc/types.js";

type Props = {
  logs: LogEntry[];
  filterBot?: number;
  height?: number;
};

export function LogPanel({ logs, filterBot, height = 12 }: Props): React.ReactElement {
  const visible = logs
    .filter((entry) => filterBot === undefined || entry.botId === filterBot)
    .slice(-height);

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>
        LOGS {filterBot === undefined ? "(all)" : `(bot ${filterBot})`}
      </Text>
      {visible.length === 0 ? <Text dimColor>No logs yet</Text> : null}
      {visible.map((entry, index) => (
        <Text key={`${entry.at}-${index}`}>
          <Text dimColor>{entry.at}</Text>
          {entry.botId ? <Text color="cyan"> bot-{entry.botId}</Text> : null} {entry.message}
        </Text>
      ))}
    </Box>
  );
}
