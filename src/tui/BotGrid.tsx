import React from "react";
import { Box, Text } from "ink";
import type { BotSnapshot, BotState } from "../ipc/types.js";

type Props = {
  bots: BotSnapshot[];
};

export function BotGrid({ bots }: Props): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Text bold>TTM Bot Control</Text>
      <Box flexWrap="wrap">
        {bots.map((bot) => (
          <Box key={bot.id} marginRight={2}>
            <Text color={stateColor(bot.state)}>
              [{bot.id}] {bot.state}
            </Text>
            {bot.detail ? <Text dimColor> {bot.detail}</Text> : null}
          </Box>
        ))}
      </Box>
    </Box>
  );
}

function stateColor(state: BotState): string {
  if (state === "DONE") return "green";
  if (state === "ERROR" || state === "STOPPED") return "red";
  if (state === "BOOKING") return "magenta";
  if (state === "IN_QUEUE" || state === "AWAITING_USER") return "yellow";
  if (state === "READY") return "cyan";
  return "gray";
}
