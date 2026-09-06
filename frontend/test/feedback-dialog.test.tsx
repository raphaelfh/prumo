import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const submitFeedback = vi.fn().mockResolvedValue(true);
vi.mock('@/hooks/useFeedback', () => ({
  useFeedback: () => ({ submitFeedback, submitting: false, error: null }),
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));

const uploadAttachment = vi.fn();
vi.mock('@/services/feedbackService', () => ({
  FeedbackService: {
    uploadAttachment: (...args: unknown[]) => uploadAttachment(...args),
  },
}));

import { FeedbackDialog } from '@/components/feedback/FeedbackDialog';

/** A File whose reported size is `size`, without allocating that many bytes. */
function fileOf(name: string, type: string, size = 1024): File {
  const file = new File(['x'], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

function pick(file: File) {
  fireEvent.change(screen.getByTestId('feedback-media-input'), { target: { files: [file] } });
}

function describeBug() {
  fireEvent.change(screen.getByLabelText(/description/i), {
    target: { value: 'The PDF viewer renders blank on the extraction screen.' },
  });
}

beforeEach(() => {
  submitFeedback.mockClear();
  uploadAttachment.mockReset();
  // jsdom implements neither half of the object-URL API.
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
});

describe('FeedbackDialog attachment', () => {
  it('offers one file picker for images and videos, and no screen capture', () => {
    render(<FeedbackDialog open onOpenChange={() => {}} />);
    const input = screen.getByTestId('feedback-media-input');
    expect(input).toHaveAttribute('type', 'file');
    expect(input.getAttribute('accept')).toContain('video/mp4');
    expect(input.getAttribute('accept')).toContain('image/png');
    expect(screen.getByText(/no file selected/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /record clip/i })).not.toBeInTheDocument();
  });

  it('previews a picked image and names the file', () => {
    render(<FeedbackDialog open onOpenChange={() => {}} />);
    pick(fileOf('shot.png', 'image/png'));
    expect(screen.getByText('shot.png')).toBeInTheDocument();
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  it('refuses an unsupported type and a file over the cap, keeping nothing attached', () => {
    render(<FeedbackDialog open onOpenChange={() => {}} />);

    pick(fileOf('notes.pdf', 'application/pdf'));
    expect(screen.getByText(/file type is not supported/i)).toBeInTheDocument();
    expect(screen.getByText(/no file selected/i)).toBeInTheDocument();

    pick(fileOf('huge.mp4', 'video/mp4', 51 * 1024 * 1024));
    expect(screen.getByText(/too large/i)).toBeInTheDocument();
    expect(screen.getByText(/no file selected/i)).toBeInTheDocument();
  });

  it('uploads the picked file and submits it as an attachment', async () => {
    uploadAttachment.mockResolvedValue({
      ok: true,
      data: { kind: 'video', storage_key: 'u1/x.mp4', content_type: 'video/mp4', size_bytes: 1024 },
    });
    render(<FeedbackDialog open onOpenChange={() => {}} />);
    describeBug();
    pick(fileOf('clip.mp4', 'video/mp4'));

    fireEvent.click(screen.getByRole('button', { name: /send feedback/i }));
    await vi.waitFor(() => expect(submitFeedback).toHaveBeenCalled());

    const [, attachments] = submitFeedback.mock.calls[0];
    expect(attachments).toEqual([
      { kind: 'video', storage_key: 'u1/x.mp4', content_type: 'video/mp4', size_bytes: 1024 },
    ]);
  });

  it('does not submit the report when the upload fails', async () => {
    uploadAttachment.mockResolvedValue({ ok: false, error: new Error('bucket refused') });
    render(<FeedbackDialog open onOpenChange={() => {}} />);
    describeBug();
    pick(fileOf('clip.mp4', 'video/mp4'));

    fireEvent.click(screen.getByRole('button', { name: /send feedback/i }));
    await vi.waitFor(() => expect(uploadAttachment).toHaveBeenCalled());
    expect(submitFeedback).not.toHaveBeenCalled();
  });

  it('submits with no attachment when none was picked', async () => {
    render(<FeedbackDialog open onOpenChange={() => {}} />);
    describeBug();

    fireEvent.click(screen.getByRole('button', { name: /send feedback/i }));
    await vi.waitFor(() => expect(submitFeedback).toHaveBeenCalled());

    expect(uploadAttachment).not.toHaveBeenCalled();
    expect(submitFeedback.mock.calls[0][1]).toEqual([]);
  });
});
