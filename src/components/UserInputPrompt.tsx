"use client";

import { useState } from "react";

interface UserInputOption {
  label: string;
  description: string;
}

interface UserInputQuestion {
  id: string;
  header: string;
  question: string;
  isOther: boolean;
  isSecret: boolean;
  options: UserInputOption[] | null;
}

interface UserInputPromptProps {
  itemId: string;
  questions: UserInputQuestion[];
  onSubmit: (answers: { [key: string]: { answers: string[] } }) => void;
  onCancel: () => void;
}

export function UserInputPrompt({
  itemId,
  questions,
  onSubmit,
  onCancel,
}: UserInputPromptProps) {
  const [answers, setAnswers] = useState<{ [key: string]: string[] }>({});
  // Track which questions are using "Other" free-form input
  const [useOther, setUseOther] = useState<{ [key: string]: boolean }>({});

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const formattedAnswers: { [key: string]: { answers: string[] } } = {};
    for (const [questionId, answerArray] of Object.entries(answers)) {
      formattedAnswers[questionId] = { answers: answerArray };
    }

    onSubmit(formattedAnswers);
  };

  const handleOptionSelect = (questionId: string, label: string) => {
    setUseOther((prev) => ({ ...prev, [questionId]: false }));
    setAnswers((prev) => ({
      ...prev,
      [questionId]: [label],
    }));
  };

  const handleOtherSelect = (questionId: string) => {
    setUseOther((prev) => ({ ...prev, [questionId]: true }));
    setAnswers((prev) => ({
      ...prev,
      [questionId]: [""],
    }));
  };

  const handleTextInput = (questionId: string, value: string) => {
    setAnswers((prev) => ({
      ...prev,
      [questionId]: [value],
    }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="mx-4 max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-lg bg-zinc-800 p-6">
        <h2 className="mb-4 text-xl font-semibold text-white">
          Input Required
        </h2>

        <form onSubmit={handleSubmit} className="space-y-6">
          {questions.map((question) => (
            <div key={question.id} className="space-y-2">
              {question.header && (
                <h3 className="text-sm font-medium text-zinc-300">
                  {question.header}
                </h3>
              )}
              <p className="text-white">{question.question}</p>

              {question.options && question.options.length > 0 ? (
                <div className="mt-3 space-y-3">
                  {/* 2x2 grid layout for options */}
                  <div className="grid grid-cols-2 gap-2">
                    {question.options.map((option) => (
                      <button
                        key={option.label}
                        type="button"
                        onClick={() =>
                          handleOptionSelect(question.id, option.label)
                        }
                        className={`rounded-lg border p-3 text-center transition-colors ${
                          answers[question.id]?.[0] === option.label &&
                          !useOther[question.id]
                            ? "border-green-500 bg-green-500/10"
                            : "border-zinc-700 hover:border-zinc-500 hover:bg-zinc-700/30"
                        }`}
                      >
                        <div className="font-medium text-white">
                          {option.label}
                        </div>
                        {option.description && (
                          <div className="mt-1 text-xs text-zinc-400">
                            {option.description}
                          </div>
                        )}
                      </button>
                    ))}
                    {/* Show "Other" option in grid when isOther is true */}
                    {question.isOther && (
                      <button
                        type="button"
                        onClick={() => handleOtherSelect(question.id)}
                        className={`rounded-lg border p-3 text-center transition-colors ${
                          useOther[question.id]
                            ? "border-green-500 bg-green-500/10"
                            : "border-zinc-700 hover:border-zinc-500 hover:bg-zinc-700/30"
                        }`}
                      >
                        <div className="font-medium text-white">Other</div>
                        <div className="mt-1 text-xs text-zinc-400">
                          Custom answer
                        </div>
                      </button>
                    )}
                  </div>
                  {/* Text input shown below grid when "Other" is selected */}
                  {question.isOther && useOther[question.id] && (
                    <input
                      type={question.isSecret ? "password" : "text"}
                      value={answers[question.id]?.[0] || ""}
                      onChange={(e) =>
                        handleTextInput(question.id, e.target.value)
                      }
                      className="w-full rounded-lg border border-zinc-700 bg-zinc-900 p-3 text-white focus:border-green-500 focus:outline-none"
                      placeholder="Enter your custom answer..."
                      autoFocus
                    />
                  )}
                </div>
              ) : (
                <input
                  type={question.isSecret ? "password" : "text"}
                  value={answers[question.id]?.[0] || ""}
                  onChange={(e) => handleTextInput(question.id, e.target.value)}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-900 p-3 text-white focus:border-green-500 focus:outline-none"
                  placeholder="Enter your answer..."
                />
              )}
            </div>
          ))}

          <div className="mt-6 flex justify-end gap-3">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg bg-zinc-700 px-4 py-2 text-white hover:bg-zinc-600"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-lg bg-green-600 px-4 py-2 text-white hover:bg-green-500"
            >
              Submit
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
