import {useCallback, useEffect, useState} from "react";

interface UseUndoRedoProps<T> {
  initialState: T;
  maxHistorySize?: number;
}

export const useUndoRedo = <T,>({ initialState, maxHistorySize = 50 }: UseUndoRedoProps<T>) => {
  const [state, setState] = useState<T>(initialState);
  const [history, setHistory] = useState<T[]>([initialState]);
  const [currentIndex, setCurrentIndex] = useState(0);

  const canUndo = currentIndex > 0;
  const canRedo = currentIndex < history.length - 1;

  const updateState = useCallback((newState: T | ((prev: T) => T)) => {
    setState((prev) => {
      const updated = typeof newState === "function" ? (newState as (prev: T) => T)(prev) : newState;
      
      setHistory((prevHistory) => {
        const newHistory = prevHistory.slice(0, currentIndex + 1);
        newHistory.push(updated);
        
        if (newHistory.length > maxHistorySize) {
          newHistory.shift();
          setCurrentIndex((prev) => prev - 1);
        }
        
        return newHistory;
      });
      
      setCurrentIndex((prev) => Math.min(prev + 1, maxHistorySize - 1));
      
      return updated;
    });
  }, [currentIndex, maxHistorySize]);

  const undo = useCallback(() => {
    if (canUndo) {
      setCurrentIndex((prev) => {
        const newIndex = prev - 1;
        setState(history[newIndex]);
        return newIndex;
      });
    }
  }, [canUndo, history]);

  const redo = useCallback(() => {
    if (canRedo) {
      setCurrentIndex((prev) => {
        const newIndex = prev + 1;
        setState(history[newIndex]);
        return newIndex;
      });
    }
  }, [canRedo, history]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        e.preventDefault();
        if (e.shiftKey) {
          redo();
        } else {
          undo();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [undo, redo]);

  return {
    state,
    setState: updateState,
    undo,
    redo,
    canUndo,
    canRedo,
  };
};
