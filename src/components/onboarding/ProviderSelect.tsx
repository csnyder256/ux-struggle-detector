import { Select } from '@/components/ui/select'

export interface ProviderSelectProps {
  name: string
  defaultValue?: 'ANTHROPIC' | 'OPENAI'
  id?: string
}

export function ProviderSelect({ name, defaultValue = 'ANTHROPIC', id }: ProviderSelectProps) {
  return (
    <Select id={id} name={name} defaultValue={defaultValue} required>
      <option value="ANTHROPIC">Anthropic (Claude)</option>
      <option value="OPENAI">OpenAI (GPT)</option>
    </Select>
  )
}
