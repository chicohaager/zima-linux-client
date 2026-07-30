import { Card, Muted, SectionTitle } from './Card'

interface Props {
  readonly title: string
  /** Which plan phase builds this screen — honest about what is not there yet. */
  readonly phase: string
}

/**
 * Says plainly that a section is not built yet.
 *
 * Deliberately not an empty screen: an empty list reads as "there is nothing here",
 * which is a different statement from "this is not implemented yet".
 */
export const PlaceholderScreen = ({ title, phase }: Props): React.JSX.Element => (
  <>
    <SectionTitle>{title}</SectionTitle>
    <Card>
      <Muted>Not implemented yet — scheduled for phase {phase} of docs/V2-PLAN.md.</Muted>
    </Card>
  </>
)
