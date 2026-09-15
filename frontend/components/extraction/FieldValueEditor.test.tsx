/**
 * FieldValueEditor — per-type emission contract. These tests are the
 * regression net for PR 1: FieldInput delegates its input rendering here, so
 * the emitted shapes proven below are exactly what the extraction form (and
 * the consensus override) rely on.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/copy', () => ({ t: (_ns: string, key: string) => key }));

import { FieldValueEditor, type FieldValueEditorField } from './FieldValueEditor';

const base = (over: Partial<FieldValueEditorField>): FieldValueEditorField => ({
  id: 'f1',
  label: 'Outcome',
  field_type: 'text',
  ...over,
});

describe('FieldValueEditor', () => {
  it('text: emits the raw string', () => {
    const onChange = vi.fn();
    render(<FieldValueEditor field={base({})} value="" onChange={onChange} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Low' } });
    expect(onChange).toHaveBeenCalledWith('Low');
  });

  it('text: a long-form label renders a textarea', () => {
    render(
      <FieldValueEditor
        field={base({ label: 'Description of methods' })}
        value=""
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole('textbox').tagName).toBe('TEXTAREA');
  });

  it('number without units: emits the raw string', () => {
    const onChange = vi.fn();
    render(
      <FieldValueEditor field={base({ field_type: 'number' })} value="" onChange={onChange} />,
    );
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '5' } });
    expect(onChange).toHaveBeenCalledWith('5');
  });

  it('number with allowed_units: emits {value, unit} with the default unit', () => {
    const onChange = vi.fn();
    render(
      <FieldValueEditor
        field={base({ field_type: 'number', allowed_units: ['mg', 'g'] })}
        value=""
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '5' } });
    expect(onChange).toHaveBeenCalledWith({ value: '5', unit: 'mg' });
  });

  it('date: emits the ISO date string', () => {
    const onChange = vi.fn();
    const { container } = render(
      <FieldValueEditor field={base({ field_type: 'date' })} value="" onChange={onChange} />,
    );
    const input = container.querySelector('input[type="date"]')!;
    fireEvent.change(input, { target: { value: '2026-01-02' } });
    expect(onChange).toHaveBeenCalledWith('2026-01-02');
  });

  it('boolean: toggling the switch emits true', () => {
    const onChange = vi.fn();
    render(
      <FieldValueEditor field={base({ field_type: 'boolean' })} value={false} onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('multiselect fallback (no allow_other): comma input emits string[]', () => {
    const onChange = vi.fn();
    render(
      <FieldValueEditor field={base({ field_type: 'multiselect' })} value={[]} onChange={onChange} />,
    );
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'a, b' } });
    expect(onChange).toHaveBeenCalledWith(['a', 'b']);
  });

  it('select: renders a combobox trigger', () => {
    render(
      <FieldValueEditor
        field={base({ field_type: 'select', allowed_values: ['Low', 'High'] })}
        value=""
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('unknown field type falls back to a text input', () => {
    const onChange = vi.fn();
    render(
      <FieldValueEditor field={base({ field_type: 'mystery' })} value="" onChange={onChange} />,
    );
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'x' } });
    expect(onChange).toHaveBeenCalledWith('x');
  });

  it('disabled: the input is disabled', () => {
    render(<FieldValueEditor field={base({})} value="" onChange={() => {}} disabled />);
    expect(screen.getByRole('textbox')).toBeDisabled();
  });
});

describe('compact FieldValueEditor', () => {
  it('allows a long value on any text field, grows with content, and preserves a manually resized height', () => {
    const onChange = vi.fn();
    const {rerender} = render(<FieldValueEditor density="compact" field={base({})} value={'Long answer '.repeat(30)} onChange={onChange} />);
    const editor = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(editor.tagName).toBe('TEXTAREA');
    Object.defineProperty(editor, 'scrollHeight', {configurable: true, value: 240});
    rerender(<FieldValueEditor density="compact" field={base({})} value={'Long answer '.repeat(31)} onChange={onChange} />);
    expect(editor.style.height).toBe('240px');
    editor.style.height = '280px'; // Native vertical resize updates inline height.
    rerender(<FieldValueEditor density="compact" field={base({})} value={'Long answer '.repeat(32)} onChange={onChange} />);
    expect(editor.style.height).toBe('280px');
    fireEvent.change(editor, {target: {value: 'Saved long answer'}});
    expect(onChange).toHaveBeenCalledWith('Saved long answer');
  });
  it('bounds automatic content growth at 320px', () => {
    const {rerender} = render(<FieldValueEditor density="compact" field={base({})} value="" onChange={vi.fn()} />);
    const editor = screen.getByRole('textbox');
    Object.defineProperty(editor, 'scrollHeight', {configurable: true, value: 1000});
    rerender(<FieldValueEditor density="compact" field={base({})} value={'x'.repeat(1000)} onChange={vi.fn()} />);
    expect(editor.style.height).toBe('320px');
  });
  it('offers human multi-select labels while emitting stored codes', async () => {
    const onChange = vi.fn();
    render(<FieldValueEditor density="compact" field={base({field_type: 'multiselect', allowed_values: [{value: 'a', label: 'Alpha'}, {value: 'b', label: 'Beta'}]})} value={['a']} onChange={onChange} />);
    expect(screen.getByRole('button')).toHaveTextContent('Alpha');
    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(await screen.findByRole('checkbox', {name: 'Beta'}));
    expect(onChange).toHaveBeenCalledWith(['a', 'b']);
  });
  it('retains numeric zero and its unit when editing', () => {
    const onChange = vi.fn();
    render(<FieldValueEditor density="compact" field={base({field_type: 'number', allowed_units: ['mg', 'g']})} value={{value: 0, unit: 'g'}} onChange={onChange} />);
    expect(screen.getByRole('spinbutton')).toHaveValue(0);
    expect(screen.getByRole('combobox')).toHaveTextContent('g');
    fireEvent.change(screen.getByRole('spinbutton'), {target: {value: '2'}});
    expect(onChange).toHaveBeenCalledWith({value: '2', unit: 'g'});
  });
  it('emits false from a boolean edit', () => {
    const onChange = vi.fn();
    render(<FieldValueEditor density="compact" field={base({field_type: 'boolean'})} value={true} onChange={onChange} />);
    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledWith(false);
  });
  it('preserves date values and saves ISO dates', () => {
    const onChange = vi.fn();
    render(<FieldValueEditor density="compact" field={base({field_type: 'date'})} value="2026-01-02" onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue('2026-01-02'), {target: {value: '2026-02-03'}});
    expect(onChange).toHaveBeenCalledWith('2026-02-03');
  });
});
