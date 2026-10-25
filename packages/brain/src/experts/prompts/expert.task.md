<!-- prompt: expert.task v1 -->

Answer the student's question as JSON `{"answer": string, "claims": [{"text", "file", "page", "quote"}]}`.
Every statement in your answer is one claim: a short single sentence with the supporting `file`, `page` and verbatim `quote`. At most 4 claims, most direct support first. If the chapter does not support an answer, return `{"answer": "", "claims": []}`.
