/**
 * One card per sensor, with the value that arrived and how old it is.
 *
 * The age is on every card, always. A number on a screen that nobody can date is worse than no number, because a person acts on it. A card whose reading has gone stale is greyed and says how long ago it last spoke, instead of continuing to look current.
 *
 * Nothing here generates, interpolates or smooths a value. What is drawn is what arrived, and a sensor that has said nothing says so.
 */

import { Box, Card, CardActionArea, Chip, Stack, Tooltip, Typography } from '@mui/material';
import { alertCounts, alertsOf } from '../alerts.js';
import { idOf, objectOf, type Binding } from '../binding.js';
import { ageText, isLive, type FeedState, type Reading } from '../readings.js';

export interface SensorCardsProps {
  bindings: Binding[];
  /** The last value received for each object, keyed by GlobalId. */
  readings: Map<string, Reading>;
  feed: FeedState;
  /** Which object is selected, so its card is marked. */
  selected: string | null;
  onSelect: (globalId: string) => void;
}

/** How many decimals a reading is shown to. More says a precision the sensor does not have. */
const DECIMALS = 1;

export function SensorCards({
  bindings, readings, feed, selected, onSelect,
}: Readonly<SensorCardsProps>) {
  // Most architectural models declare no sensors, so this is the ordinary case
  // and not a failure. An explanation of it on every such model is a paragraph
  // a person reads once and then has to scroll past forever.
  if (bindings.length === 0) return null;

  // What a person wants to know before reading twenty cards is whether any of
  // them needs them. The counts say that in one line, and the cards say which.
  const counts = alertCounts(bindings, readings, objectOf, feed);

  return (
    <Stack sx={{ gap: 0.75 }}>
      {(counts.warn > 0 || counts.note > 0) && (
        <Stack direction="row" sx={{ gap: 0.5, flexWrap: 'wrap' }}>
          {counts.warn > 0 && (
            <Chip
              size="small"
              color="warning"
              label={`${counts.warn} of ${bindings.length} need attention`}
            />
          )}
          {counts.note > 0 && (
            <Chip
              size="small"
              variant="outlined"
              label={`${counts.note} not measured directly`}
            />
          )}
        </Stack>
      )}
      {bindings.map((binding) => {
        const globalId = objectOf(binding);
        const reading = globalId ? readings.get(globalId) : undefined;
        const live = isLive(reading, feed);
        // The payload's own unit wins on the card. A difference from the
        // manifest is one of the alerts below, since silently trusting either
        // is a wrong number in a building.
        const unit = reading?.unit ?? binding.display?.unit;
        const alerts = alertsOf(binding, reading, feed);

        return (
          <Card
            key={binding.label}
            variant="outlined"
            sx={{
              opacity: live ? 1 : 0.55,
              borderColor: globalId === selected ? 'primary.main' : undefined,
            }}
          >
            <CardActionArea
              sx={{ p: 1 }}
              disabled={!globalId}
              onClick={() => globalId && onSelect(globalId)}
            >
              <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}>
                <Typography variant="subtitle2">{idOf(binding)}</Typography>
                <Typography variant="subtitle2">
                  {reading === undefined ? 'Waiting' : `${reading.value.toFixed(DECIMALS)} ${unit}`}
                </Typography>
              </Box>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                {binding.label}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                {ageText(reading, feed)}
              </Typography>
              {alerts.length > 0 && (
                <Stack direction="row" sx={{ gap: 0.5, mt: 0.5, flexWrap: 'wrap' }}>
                  {alerts.map((alert) => (
                    // The chip is the short form and the tooltip is the
                    // sentence. A person scanning twenty cards reads the
                    // chips, and only the one they stop on needs the reason.
                    <Tooltip key={alert.label} title={alert.detail}>
                      <Chip
                        size="small"
                        color={alert.level === 'warn' ? 'warning' : 'default'}
                        variant={alert.level === 'warn' ? 'filled' : 'outlined'}
                        label={alert.label}
                      />
                    </Tooltip>
                  ))}
                </Stack>
              )}
            </CardActionArea>
          </Card>
        );
      })}
    </Stack>
  );
}

export default SensorCards;
