export interface Question {
  line: number | null;
  code: string;
  text: string;
}

export interface NoteResult {
  questions: Question[];
}
