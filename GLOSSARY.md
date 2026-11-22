# Glossary — Terms & Meanings

This file lists project-specific and technical terms that may cause confusion between Arabic and English. It is written in English, with each entry showing the **English meaning** and the **Arabic meaning (المعنى بالعربية)**.

---

## CLI Commands

### `assignments`
- **English meaning**: A command group for listing course assignments (online quizzes, offline/paper tasks, and other deliverables) visible to the student.
- **المعنى بالعربية**: مجموعة أوامر لعرض المهام والتقييمات (الاختبارات الإلكترونية، الواجبات الورقية، وغيرها) الظاهرة للطالب.

### `list`
- **English meaning**: Fetches and displays all assignments for the selected class without filtering by due date.
- **المعنى بالعربية**: يجلب ويعرض جميع التقييمات للقسم المحدد دون تصفية حسب تاريخ الاستحقاق.

### `due`
- **English meaning**: Fetches only assignments/quizzes that are currently due or pending submission.
- **المعنى بالعربية**: يجلب فقط التقييمات المستحقة أو التي تنتظر التسليم حالياً.

### `lessons`
- **English meaning**: A command group for listing lessons and their sections/units within the LMS.
- **المعنى بالعربية**: مجموعة أوامر لعرض الدروس وأقسامها/وحداتها داخل نظام التعلم.

### `quiz`
- **English meaning**: A command group for inspecting, scanning, and drafting quiz attempts.
- **المعنى بالعربية**: مجموعة أوامر لفحص الاختبارات ومسحها وحفظ مسوداتها.

### `inspect`
- **English meaning**: Read-only examination of a single quiz — fetches questions and details without submitting anything.
- **المعنى بالعربية**: فحص قراءة فقط لاختبار واحد — يجلب الأسئلة والتفاصيل دون إرسال أي شيء.

### `scan`
- **English meaning**: Read-only sweep across all due quizzes in a class, inspecting those that already have an open/resumed attempt.
- **المعنى بالعربية**: مسح قراءة فقط لجميع الاختبارات المستحقة في القسم، وفحص ما لها محاولة مفتوحة أو مستأنفة.

### `draft`
- **English meaning**: Saving partial answers to a quiz attempt without finishing or submitting it.
- **المعنى بالعربية**: حفظ إجابات جزئية في محاولة الاختبار دون إنهائها أو تسليمها.

### `monitor`
- **English meaning**: Fetches given URLs and extracts/logs sanitized page information and HTTP traces.
- **المعنى بالعربية**: يجلب روابط محددة ويستخرج/يسجل معلومات الصفحة ومنطق طلبات HTTP بعد إخفاء البيانات الحساسة.

---

## CLI Options / Flags

### `--class-id`
- **English meaning**: The numeric ID of the class/section to scope commands to. Can also come from `LMS_CLASS_ID` in `.env` or be replaced by `--url`.
- **المعنى بالعربية**: المعرّف الرقمي للقسم/الشعبة الذي تُطبق عليه الأوامر. يمكن أن يأتي من `LMS_CLASS_ID` في `.env` أو يُستبدل بـ `--url`.

### `--url`
- **English meaning**: A full custom URL that overrides the default route built from `--class-id`.
- **المعنى بالعربية**: رابط كامل مخصص يتجاوز المسار الافتراضي المبني من `--class-id`.

### `--results-id`
- **English meaning**: The ID of a specific quiz attempt (results row) used to resume/inspect an in-progress attempt directly.
- **المعنى بالعربية**: معرّف محاولة اختبار محددة (سجل النتائج) المستخدم لاستئناف/فحص محاولة جارية مباشرة.

### `--start-new`
- **English meaning**: Explicit opt-in flag that allows inspecting a quiz attempt that has never been opened before (which would otherwise be skipped to avoid consuming a fresh attempt).
- **المعنى بالعربية**: علم موافقة صريحة يسمح بفحص محاولة اختبار لم تُفتح من قبل (التي يتم تخطيها افتراضياً لتجنب استهلاك محاولة جديدة).

### `--answers`
- **English meaning**: A JSON string (or `@file` path) mapping question part numbers to the answers to save as a draft.
- **المعنى بالعربية**: نص JSON (أو مسار `@file`) يربط أرقام أجزاء الأسئلة بالإجابات المراد حفظها كمسودة.

### `--apply`
- **English meaning**: Actually sends the draft POST requests (and pause) instead of running in safe dry-run preview mode.
- **المعنى بالعربية**: يرسل طلبات POST للمسودة فعلياً (مع الإيقاف المؤقت) بدلاً من الوضع الآمن للمعاينة فقط.

### `--no-pause`
- **English meaning**: When used with `--apply`, skips the final POST to `/pause/` after saving drafts.
- **المعنى بالعربية**: عند استخدامه مع `--apply`، يتخطى طلب POST الأخير إلى `/pause/` بعد حفظ المسودات.

### `--allow-timed`
- **English meaning**: Allows running `quiz draft` on timed quizzes (`timed_quiz: true`), which is aborted by default.
- **المعنى بالعربية**: يسمح بتشغيل `quiz draft` على الاختبارات الموقوتة (`timed_quiz: true`) التي يتم إيقافها افتراضياً.

### `--no-report`
- **English meaning**: Skips writing the generated Markdown report to disk.
- **المعنى بالعربية**: يتخطى كتابة تقرير Markdown المولّد على القرص.

### `--quiet`
- **English meaning**: Suppresses verbose per-request HTTP logs; only summaries/errors remain.
- **المعنى بالعربية**: يخفي سجلات HTTP التفصيلية لكل طلب؛ تبقى الملخصات والأخطاء فقط.

### `--out-dir`
- **English meaning**: Overrides the default `reports/` output directory with a custom path.
- **المعنى بالعربية**: يستبدل مجلد الإخراج الافتراضي `reports/` بمسار مخصص.

### `--selector`
- **English meaning**: A custom CSS selector used by `monitor` to extract DOM elements from a page.
- **المعنى بالعربية**: محدد CSS مخصص يستخدمه `monitor` لاستخراج عناصر DOM من الصفحة.

### `--help` / `-h`
- **English meaning**: Prints usage information for the command or subcommand.
- **المعنى بالعربية**: يعرض معلومات الاستخدام للأمر أو الأمر الفرعي.

---

## LMS Concepts & Routes

### show URL / show page
- **English meaning**: The landing page of a quiz (`/student_quiz_assignment/show/<id>`) showing title, description, and the start/resume button.
- **المعنى بالعربية**: صفحة هبوط الاختبار تعرض العنوان والوصف وزر البدء/الاستئناف.

### display URL / display page
- **English meaning**: The active attempt page (`/student_take_quiz_assignment/display/<id>?part=N&results=M`) where questions are shown.
- **المعنى بالعربية**: صفحة المحاولة النشطة التي تعرض الأسئلة.

### `init_quiz`
- **English meaning**: A JavaScript configuration block embedded in quiz pages containing `quiz_id`, `results_id`, `part`, `parts`, `timed_quiz`, `time_left`, etc.
- **المعنى بالعربية**: كتلة إعدادات JavaScript مضمّنة في صفحات الاختبار تحتوي على معرّفات الاختبار والمحاولة والأجزاء والإعدادات الزمنية.

### results ID
- **English meaning**: Identifies a specific student's attempt row for a quiz (the `results=` query parameter).
- **المعنى بالعربية**: يعرّف سجل محاولة طالب محددة للاختبار (معامل `results=`).

### timed quiz
- **English meaning**: A quiz with a countdown timer; draft operations on it are blocked unless `--allow-timed` is passed.
- **المعنى بالعربية**: اختبار بوقت محدد للانتهاء؛ عمليات المسودة عليه محظورة ما لم يُمرر `--allow-timed`.

### pause (`/pause/`)
- **English meaning**: The endpoint used to pause/save an in-progress quiz attempt so it remains resumable.
- **المعنى بالعربية**: نقطة النهاية المستخدمة لإيقاف/حفظ محاولة اختبار جارية بحيث تبقى قابلة للاستئناف.

### finish (`/finish/`)
- **English meaning**: The endpoint that submits/finalizes a quiz attempt. **Blocked unconditionally** by this tool at the HTTP client layer.
- **المعنى بالعربية**: نقطة النهاية التي تسلّم/تنهِي محاولة الاختبار. **محظورة دائماً** في هذه الأداة على مستوى عميل HTTP.

### dry-run
- **English meaning**: A mode that simulates an action (previewing what would be sent) without actually performing it. `quiz draft` is dry-run by default.
- **المعنى بالعربية**: وضع يحاكي الإجراء (معاينة ما سيتم إرساله) دون تنفيذه فعلياً. `quiz draft` يعمل به افتراضياً.

### read-only (GET only)
- **English meaning**: Commands that only issue HTTP `GET` requests — they fetch data but never modify server state.
- **المعنى بالعربية**: أوامر تصدر طلبات HTTP `GET` فقط — تجلب البيانات دون تعديل حالة الخادم.

---

## Question/Answer Terminology

### question part
- **English meaning**: One page/screen of a multi-part quiz, identified by `part=N`.
- **المعنى بالعربية**: صفحة/شاشة واحدة من اختبار متعدد الأجزاء، تُعرَّف بـ `part=N`.

### single choice
- **English meaning**: A question type where exactly one option must be selected (radio inputs).
- **المعنى بالعربية**: نوع سؤال يجب فيه اختيار خيار واحد فقط (مدخلات radio).

### multiple choice
- **English meaning**: A question type where one or more options can be selected (checkbox inputs).
- **المعنى بالعربية**: نوع سؤال يمكن فيه اختيار خيار واحد أو أكثر (مدخلات checkbox).

### free text
- **English meaning**: A question answered by typing text into an input or textarea.
- **المعنى بالعربية**: سؤال تُجاب عليه بكتابة نص في حقل إدخال أو textarea.

### structured input
- **English meaning**: Questions with multiple indexed/array answer fields such as `answer[1]`, `answer[2]`, `answer[...]`.
- **المعنى بالعربية**: أسئلة لها حقول إجابة متعددة مفهرسة مثل `answer[1]`، `answer[2]`، `answer[...]`.

### rich text editor
- **English meaning**: A WYSIWYG editor (e.g., CKEditor) allowing formatted answers with bold/italic/etc.
- **المعنى بالعربية**: محرر نص منسق (مثل CKEditor) يسمح بإجابات منسقة.

### file upload
- **English meaning**: A question that accepts file attachments via `<input type="file">`.
- **المعنى بالعربية**: سؤال يقبل مرفقات ملفات عبر `<input type="file">`.

---

## Security & Reporting Terms

### `LMS_COOKIE`
- **English meaning**: The authenticated browser session cookie header for the LMS, stored in `.env`. Never printed; masked as `"VALUES"`.
- **المعنى بالعربية**: ترويسة كوكيز جلسة المتصفح الموثّق لنظام التعلم، مخزّنة في `.env`. لا تُطبع أبداً؛ تُخفى كـ `"VALUES"`.

### CSRF / authenticity token
- **English meaning**: A security token embedded in forms/meta tags that prevents cross-site request forgery. Always masked in outputs.
- **المعنى بالعربية**: رمز أمان مضمّن في النماذج/وسوم meta يمنع هجمات تزوير الطلبات. يُخفى دائماً في المخرجات.

### sanitizer / masking
- **English meaning**: The process of replacing sensitive values (cookies, tokens, secrets) with the literal string `"VALUES"` in logs and reports.
- **المعنى بالعربية**: عملية استبدال القيم الحساسة (الكوكيز، الرموز، الأسرار) بالنص الحرفي `"VALUES"` في السجلات والتقارير.

### `"VALUES"`
- **English meaning**: The placeholder string used everywhere a real secret would appear.
- **المعنى بالعربية**: النص البديل المستخدم في كل مكان كان سيظهر فيه سر حقيقي.

### `latest.md`
- **English meaning**: A copy of the most recent report in each `reports/<command>/` folder for quick access.
- **المعنى بالعربية**: نسخة من أحدث تقرير في كل مجلد `reports/<command>/` للوصول السريع.

### `SanitizedHttpTrace`
- **English meaning**: A record of an HTTP request/response with all sensitive fields masked, used in monitor reports.
- **المعنى بالعربية**: سجل لطلب/استجابة HTTP مع إخفاء كل الحقول الحساسة، يُستخدم في تقارير المراقبة.

### cookie jar
- **English meaning**: An in-memory store (`SessionCookieJar`) that collects `Set-Cookie` headers across requests so subsequent requests stay authenticated.
- **المعنى بالعربية**: مخزن في الذاكرة يجمع ترويسات `Set-Cookie` عبر الطلبات بحيث تبقى الطلبات اللاحقة موثّقة.
