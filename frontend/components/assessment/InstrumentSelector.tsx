import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from "@/components/ui/select";
import {Label} from "@/components/ui/label";
import {AssessmentInstrument} from "@/hooks/assessment/useAssessmentInstruments";

interface InstrumentSelectorProps {
  instruments: AssessmentInstrument[];
  value: string | null;
  onValueChange: (value: string) => void;
  disabled?: boolean;
}

export const InstrumentSelector = ({
  instruments,
  value,
  onValueChange,
  disabled = false,
}: InstrumentSelectorProps) => {
  return (
    <div className="space-y-2">
      <Label htmlFor="instrument">Instrumento de Avaliação</Label>
      <Select value={value || undefined} onValueChange={onValueChange} disabled={disabled}>
        <SelectTrigger id="instrument">
          <SelectValue placeholder="Selecione um instrumento" />
        </SelectTrigger>
        <SelectContent>
          {instruments.map((instrument) => (
            <SelectItem key={instrument.id} value={instrument.id}>
              {instrument.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};
