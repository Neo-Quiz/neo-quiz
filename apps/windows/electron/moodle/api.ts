/* The Moodle API calls (main process): the user's courses and the scan of one
   course (contents + assignments + submission states). Read-only. */

import type { Client } from "./client";
import { TokenError } from "./erreurs";
import { applyStatus } from "./disque";
import { dedupe, flattenContents, parseCourse, parseSubmission, type Course, type Scan, type Submission } from "./pur";

export async function listCourses(client: Client, userid: number): Promise<Course[]> {
	const raw = await client.call("core_enrol_get_users_courses", { userid });
	return (Array.isArray(raw) ? raw : []).map(parseCourse).filter(c => Number.isSafeInteger(c.id) && c.id > 0);
}

/** One course: content and assignments in parallel, then the submission state
    of each assignment. `dir` (the module folder, or null) sets the file statuses. */
export async function scanCourse(client: Client, courseId: number, dir: string | null): Promise<Scan> {
	const [sections, assigns] = await Promise.all([
		client.call("core_course_get_contents", { courseid: courseId }),
		client.call("mod_assign_get_assignments", { "courseids[0]": courseId }),
	]);
	const assignments: any[] = ((assigns.courses || [])[0] || {}).assignments || [];
	const deposits = new Map<number, Submission>();
	await Promise.all(assignments.map(async a => {
		try {
			deposits.set(a.cmid, parseSubmission(await client.call("mod_assign_get_submission_status", { assignid: a.id })));
		} catch (e) {
			// A closed or inaccessible assignment does not stop the rest; a dead token does.
			if (e instanceof TokenError) throw e;
		}
	}));
	const tree = dedupe(flattenContents(Array.isArray(sections) ? sections : [], assignments, deposits));
	const external = [...new Set(tree.flatMap(s => s.activities.flatMap(a => a.external)))];
	return applyStatus({ sections: tree, external }, dir);
}
