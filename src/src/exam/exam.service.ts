import { Injectable } from '@nestjs/common';
import { createObjectCsvStringifier } from 'csv-writer';
import { HasuraService as HasuraServiceFromServices } from '../services/hasura/hasura.service';

import { UploadFileService } from 'src/upload-file/upload-file.service';
import { ExamResultPattern } from './exam.result.pattern';

//pdf data extractor
const parse = require('pdf-parse');

@Injectable()
export class ExamService {
	constructor(
		private hasuraServiceFromServices: HasuraServiceFromServices,
		private uploadFileService: UploadFileService,
		private examResultPattern: ExamResultPattern,
	) {}

	async getExamSchedule(id: any, resp: any, request: any) {
		let program_id = request?.mw_program_id;
		let academic_year_id = request?.mw_academic_year_id;
		let data;
		data = {
			query: `query MyQuery {
                subjects(where: {board_id: {_eq: ${id}}}) {
                  name
                  id
                  board
                  board_id
                  is_theory
                  is_practical
				  theory_marks
				  practical_marks
				  sessional_marks
				  total_marks
				  subject_type
				  events(where: {context: {_eq: "subjects"}, program_id: {_eq:${program_id}}, academic_year_id: {_eq:${academic_year_id}}}){
                    context
                    context_id
                    program_id
                    academic_year_id
                    id
                    start_date
                    end_date
                    type
                    status
                  }
                }
              }
                 
              `,
		};
		let response = await this.hasuraServiceFromServices.queryWithVariable(
			data,
		);

		let newQdata = response?.data?.data?.subjects;

		if (newQdata?.length > 0) {
			return resp.status(200).json({
				success: true,
				message: 'Data found successfully!',
				data: newQdata,
			});
		} else {
			return resp.status(422).json({
				success: true,
				message: 'Data Not Found',
				data: {},
			});
		}
	}

	async createExamSchedule(body, response, request) {
		let result = [];
		let user_id = request?.mw_userid;
		let academic_year_id = request?.mw_academic_year_id;
		let program_id = request?.mw_program_id;
		let validation_query;
		let validation_data;
		let validation_response;
		let event_id;

		for (const schedule of body) {
			validation_data = {
				query: `
					query MyQuery {
						events(where: {context: {_eq: "subjects"}, academic_year_id: {_eq:${academic_year_id}}, context_id: {_eq:${schedule?.subject_id}}, program_id: {_eq:${program_id}}, type: {_eq:"${schedule?.type}"}}) {
							id
						}
					}
				`,
			};

			validation_response =
				await this.hasuraServiceFromServices.queryWithVariable(
					validation_data,
				);

			event_id = validation_response?.data?.data?.events?.[0]?.id;

			let query;

			if (event_id) {
				query = `
					mutation UpdateEvent {
						update_events_by_pk(pk_columns: {id: ${event_id}}, _set: {
				`;
			} else {
				query = `
					mutation CreateEvent {
						insert_events_one(object: {
							context: "subjects",
							program_id: ${program_id},
							academic_year_id: ${academic_year_id},
							created_by:${user_id},
							updated_by:${user_id},
				`;
			}

			Object.keys(schedule).forEach((key) => {
				if (schedule[key] !== null && schedule[key] !== '') {
					if (key === 'subject_id') {
						query += `context_id: ${schedule[key]}, `;
					} else if (key === 'exam_date') {
						// Assuming exam_date is in the format 'YYYY-MM-DD'
						query += `start_date: "${schedule[key]}", `;
						query += `end_date: "${schedule[key]}", `;
					} else if (Array.isArray(schedule[key])) {
						query += `${key}: "${JSON.stringify(schedule[key])}", `;
					} else {
						query += `${key}: "${schedule[key]}", `;
					}
				}
			});

			query = query.slice(0, -2); // Remove trailing comma and space

			query += `
						}) {
							id
							context_id
							context
							start_date
							end_date
							program_id
							academic_year_id
							type
							status
							created_by
							updated_by
						}
					}
				`;

			let data = {
				query: `${query}`,
				variables: {},
			};

			const query_response =
				await this.hasuraServiceFromServices.queryWithVariable(data);
			const updatedOrCreatedEvent =
				query_response?.data?.data?.[
					event_id ? 'update_events_by_pk' : 'insert_events_one'
				];

			if (updatedOrCreatedEvent) {
				result.push(updatedOrCreatedEvent);
			}
		}

		if (result.length > 0) {
			return response.status(200).json({
				success: true,
				message: 'Exam schedule created or updated successfully!',
				data: result,
			});
		} else {
			return response.status(500).json({
				success: false,
				message: 'Unable to create or update exam schedule!',
				data: {},
			});
		}
	}

	async editExamSchedule(body, response, request) {
		let result = [];
		let academic_year_id = request?.mw_academic_year_id;
		let program_id = request?.mw_program_id;

		// Loop through each input in the bulk request
		for (let input of body) {
			let event_validation_data;
			let event_validation_response;
			let event_id;

			let attendance_validation_data;
			let attendance_validation_response;
			let attendance_id;

			// Validate event
			event_validation_data = {
				query: `
					query MyQuery {
						events(where: {context: {_eq: "subjects"}, academic_year_id: {_eq:${academic_year_id}}, context_id: {_eq:${input?.subject_id}}, program_id: {_eq:${program_id}}, type: {_eq:"${input?.type}"}}) {
							id
						}
					}
				`,
			};

			event_validation_response =
				await this.hasuraServiceFromServices.queryWithVariable(
					event_validation_data,
				);

			event_id = event_validation_response?.data?.data?.events?.[0]?.id;

			// Validate attendance
			if (event_id) {
				attendance_validation_data = {
					query: `
						query MyQuery2 {
							attendance(where: {context_id: {_eq:${event_id}},context:{_eq:"events"}}){
							id
							}
						}
					`,
				};

				attendance_validation_response =
					await this.hasuraServiceFromServices.queryWithVariable(
						attendance_validation_data,
					);

				attendance_id =
					attendance_validation_response?.data?.data?.attendance?.[0]
						?.id;
			}

			// Push result to the response array
			if (!event_id) {
				result.push({
					subject_id: input?.subject_id,
					is_editable: false,
					type: input?.type,
					message: 'Event doesnt exists',
				});
			} else if (attendance_id) {
				result.push({
					subject_id: input?.subject_id,
					is_editable: false,
					type: input?.type,
					message: 'Attendance for event subject exists',
				});
			} else {
				result.push({
					subject_id: input?.subject_id,
					is_editable: true,
					type: input?.type,
					message: 'Event can be edited',
				});
			}
		}

		// Return the response array
		return response.status(200).json(result);
	}

	async getExamScheduleByBoardIdAndDate(
		id: any,
		date: string,
		resp: any,
		request: any,
	) {
		let board_id = id;
		let academic_year_id = request?.mw_academic_year_id;
		let program_id = request?.mw_program_id;
		let data;
		let subject_id_data;

		subject_id_data = {
			query: `query MyQuery2 {
					subjects(where: {board_id: {_eq:${board_id}}}){
					  id
					}
				  }`,
		};

		let subject_id_response =
			await this.hasuraServiceFromServices.queryWithVariable(
				subject_id_data,
			);

		let subject_id_result = subject_id_response?.data?.data?.subjects;

		const ids = subject_id_result?.map((subject) => subject.id);

		data = {
			query: `query MyQuery {
				subjects(where: {board_id: {_eq:${board_id}}, events: {context_id: {_in:[${ids}]}, context: {_eq: "subjects"}, start_date: {_eq: "${date}"},academic_year_id:{_eq:${academic_year_id}},program_id:{_eq:${program_id}}}}) {
				  name
				  id
				  board
				  board_id
				  is_theory
				  is_practical
				  theory_marks
				  practical_marks
				  sessional_marks
				  total_marks
				  events(where: {start_date: {_eq: "${date}"},academic_year_id:{_eq:${academic_year_id}},program_id:{_eq:${program_id}}}) {
					context
					context_id
					program_id
					academic_year_id
					id
					start_date
					end_date
					type
					status
				  }
				}
			  }
			  `,
		};

		let response = await this.hasuraServiceFromServices.queryWithVariable(
			data,
		);

		let newQdata = response?.data?.data?.subjects;

		if (newQdata?.length > 0) {
			return resp.status(200).json({
				success: true,
				message: 'Data found successfully!',
				data: newQdata,
			});
		} else {
			return resp.status(422).json({
				success: true,
				message: 'Data Not Found',
				data: {},
			});
		}
	}

	async getLearnerAttendanceBySubjectId(bodyArray, request, response) {
		let academic_year_id = request?.mw_academic_year_id;
		let program_id = request?.mw_program_id;
		let user_id = request?.mw_userid;
		let resultArray = [];

		for (let input of bodyArray) {
			let subject_data;
			let result;
			let learner_ids = [];
			let program_beneficiaries = [];
			let attendance_data;
			let attendance_result;
			let users_data;

			subject_data = {
				query: `query MyQuery2 {
					program_beneficiaries(where: {facilitator_id: {_eq:${user_id}}, academic_year_id:{_eq:${academic_year_id}}, program_id:{_eq:${program_id}}, subjects: {_ilike: "%\\"${input?.subject_id}\\"%"}, status: {_eq: "registered_in_camp"}}) {
						user_id
					}
				  }
			  `,
			};

			result = await this.hasuraServiceFromServices.queryWithVariable(
				subject_data,
			);

			program_beneficiaries = result?.data?.data?.program_beneficiaries;

			learner_ids = program_beneficiaries.map(
				(beneficiary) => beneficiary.user_id,
			);

			attendance_data = {
				query: `query MyQuery {
					users(where: {id: {_in: [${learner_ids}]}}) {
						user_id: id
						first_name
						middle_name
						last_name
						attendances(where: {context: {_eq: "events"}, context_id: {_eq:${input?.event_id}}}) {
							id
							context
							context_id
							status
						}
					}
					events(where: {id: {_eq: ${input?.event_id}}}) {
						id
						start_date
						end_date
					}
				  }`,
			};

			attendance_result =
				await this.hasuraServiceFromServices.queryWithVariable(
					attendance_data,
				);

			users_data = attendance_result?.data?.data?.users;
			const events_data = attendance_result?.data?.data?.events;
			resultArray.push({
				subject_id: input?.subject_id,
				subject_name: input?.subject_name,
				event_id: input?.event_id,
				type: input?.type,
				data: users_data,
				events_data,
			});
		}

		return response.status(200).json({
			success: true,
			message: 'Retrieved data successfully!',
			data: resultArray,
		});
	}

	async addExamScheduleAttendance(body, response, request) {
		let result = [];
		let user_id = request?.mw_userid;
		let validation_data;
		let validation_response;
		let attendance_id;

		for (const schedule of body) {
			validation_data = {
				query: `
				query MyQuery {
					attendance(where: {context: {_eq: "events"}, context_id: {_eq:${schedule?.event_id}}, user_id: {_eq:${schedule?.user_id}}}){
					  id
					}
				  }
				  `,
			};

			validation_response =
				await this.hasuraServiceFromServices.queryWithVariable(
					validation_data,
				);

			attendance_id =
				validation_response?.data?.data?.attendance?.[0]?.id;

			let query;

			if (attendance_id) {
				query = `
					mutation UpdateAttendance {
						update_attendance_by_pk(pk_columns: {id: ${attendance_id}}, _set: {
				`;
			} else {
				query = `
					mutation CreateAttendance {
						insert_attendance_one(object: {
							context: "events",
							created_by:${user_id},
							updated_by:${user_id},
				`;
			}

			Object.keys(schedule).forEach((key) => {
				if (schedule[key] !== null && schedule[key] !== '') {
					if (key === 'event_id') {
						query += `context_id: ${schedule[key]}, `;
					} else if (key === 'attendance_date') {
						// Assuming date_time is in the format 'YYYY-MM-DD:HH-MM-SS'
						query += `date_time: "${schedule[key]}", `;
					} else if (Array.isArray(schedule[key])) {
						query += `${key}: "${JSON.stringify(schedule[key])}", `;
					} else {
						query += `${key}: "${schedule[key]}", `;
					}
				}
			});

			query = query.slice(0, -2); // Remove trailing comma and space

			query += `
						}) {
							id
							context_id
							context
							status
							attendance_reason
							date_time
							user_id
							created_by
							updated_by
							
						}
					}
				`;

			let data = {
				query: `${query}`,
				variables: {},
			};

			const query_response =
				await this.hasuraServiceFromServices.queryWithVariable(data);
			const updatedOrCreatedEvent =
				query_response?.data?.data?.[
					attendance_id
						? 'update_attendance_by_pk'
						: 'insert_attendance_one'
				];

			if (updatedOrCreatedEvent) {
				result.push(updatedOrCreatedEvent);
			}
		}

		if (result.length > 0) {
			return response.status(200).json({
				success: true,
				message: 'Attendance created or updated successfully!',
				data: result,
			});
		} else {
			return response.status(500).json({
				success: false,
				message: 'Unable to create or update attendance!',
				data: {},
			});
		}
	}

	async getAttendanceReport(body: any, request: any, response: any) {
		let academic_year_id = request?.mw_academic_year_id;
		let program_id = request?.mw_program_id;
		let user_id = request?.mw_userid;
		let data;
		let result;
		let validation_response;
		let sql;

		data = {
			query: `query MyQuery {
				program_beneficiaries(where: {academic_year_id: {_eq:${academic_year_id}}, status:{_eq:"registered_in_camp"},program_id: {_eq:${program_id}}, facilitator_id: {_eq:${user_id}}}){
				  id
				  subjects
				  is_continued
				  exam_fee_date
	   			  syc_subjects
				  exam_fee_document_id
				}
			  }
			  `,
		};

		validation_response =
			await this.hasuraServiceFromServices.queryWithVariable(data);

		result = validation_response?.data?.data?.program_beneficiaries;

		const subjects = new Set();
		result.forEach((beneficiary) => {
			if (beneficiary?.subjects !== null) {
				JSON.parse(beneficiary?.subjects).forEach((subject) => {
					// Parse subject as integer before adding to the set
					subjects.add(parseInt(subject));
				});
			}
		});

		// Convert set to array for easier manipulation
		const uniqueSubjects = Array.from(subjects);
		// Map each element in uniqueSubjects array to a string with parentheses

		const formattedSubjects = `(${uniqueSubjects.join(',')})`;
		console.log(formattedSubjects); // Output: (10,19)

		sql = ` SELECT 
		events.id AS eventid,
		context_id,
		context,
		start_date,
		su.id,
		su.name,
		bo.id AS boardid,
		bo.name AS boardname,
		(SELECT COUNT(id) FROM program_beneficiaries WHERE status IN ('registered_in_camp','pragati_syc','10th_pass') AND facilitator_id = ${user_id} AND EXISTS (SELECT 1 FROM json_array_elements_text(subjects::json) AS item WHERE item::text = CAST(su.id AS TEXT))) AS total_students,
		(SELECT COUNT(id) FROM attendance att WHERE att.context_id = events.id AND att.context = 'events' AND att.status = 'present' AND att.created_by = ${user_id}) AS present,
		(SELECT COUNT(id) FROM attendance att WHERE att.context_id = events.id AND att.context = 'events' AND att.status = 'absent'  AND att.created_by = ${user_id}) AS absent
	FROM 
		events
	LEFT JOIN  
		subjects su ON events.context_id = su.id
	LEFT JOIN  
		boards bo ON su.board_id = bo.id
	WHERE 
		context = 'subjects' AND context_id IN ${formattedSubjects} AND academic_year_id = ${academic_year_id} AND events.program_id = ${program_id};`;

		const attendance_report_data = (
			await this.hasuraServiceFromServices.executeRawSql(sql)
		)?.result;

		if (attendance_report_data == undefined) {
			return response.status(404).json({
				status: false,
				message: 'Data not found',
				data: [],
			});
		}

		let attendance_report_result =
			this.hasuraServiceFromServices.getFormattedData(
				attendance_report_data,
			);

		// Calculate not_marked for each instance
		attendance_report_result.forEach((report) => {
			report.not_marked = (
				parseInt(report.total_students) -
				(parseInt(report.present) + parseInt(report.absent))
			)?.toString();
		});

		return response.status(200).json({
			status: true,
			message: 'Data retrieved successfully',
			data: attendance_report_result,
		});
	}

	async createExamResult(body: any, request: any, response: any) {
		let program_id = request?.mw_program_id;
		let academic_year_id = request?.mw_academic_year_id;
		let examResultBody = body;

		let examResult = await this.ExamResultUpsert(
			examResultBody,
			academic_year_id,
			program_id,
		);

		if (examResult) {
			return response.status(200).json({
				data: examResult,
			});
		} else {
			return response.status(500).json({
				data: [],
			});
		}
	}

	async ExamResultUpsert(examResultBody, academic_year_id, program_id) {
		let data;
		let vquery;
		let vresponse;
		let result: { subject?: any[] } = {}; // Define the type of result
		let subjects_response = [];

		let mutation_query;
		let set_update;
		let exam_result_subjects_id;
		let exam_result_response;

		const { subject, ...exam_result } = examResultBody;

		// Check for existing exam result data

		vquery = `
			query MyQuery {
				exam_results(where: {user_id: {_eq: ${exam_result?.user_id}}, academic_year_id: {_eq:${academic_year_id}}, program_id: {_eq:${program_id}}, board_id: {_eq:${exam_result?.board_id}}}){
					id
				}
			}
		`;

		vresponse = await this.hasuraServiceFromServices.getData({
			query: vquery,
		});

		let exam_result_id = vresponse?.data?.exam_results?.[0]?.id;

		set_update = exam_result_id ? 1 : 0; // Set the update flag

		if (set_update == 1) {
			mutation_query = `
				mutation UpdateExamResults {
					update_exam_results_by_pk(pk_columns: {id: ${exam_result_id}}, _set: {
			`;
		} else {
			mutation_query = `
				mutation CreateExamResults {
					insert_exam_results_one(object: {
						program_id: ${program_id},
						academic_year_id: ${academic_year_id},
			`;
		}

		Object.keys(exam_result).forEach((key) => {
			if (exam_result[key] !== null && exam_result[key] !== '') {
				if (
					key == 'user_id' ||
					key == 'board_id' ||
					key == 'total_marks'
				) {
					mutation_query += `${key}: ${exam_result[key]}, `;
				} else {
					mutation_query += `${key}: "${exam_result[key]}", `;
				}
			}
		});

		mutation_query = mutation_query.slice(0, -2); // Remove trailing comma and space

		mutation_query += `
					}) {
						id
						user_id
						board_id
						enrollment
						candidate
						father
						mother
						dob
						course_class
						exam_year
						total_marks
						final_result
					}
				}
			`;

		console.log('mutation_query', mutation_query);
		data = {
			query: `${mutation_query}`,
			variables: {},
		};

		const query_response =
			await this.hasuraServiceFromServices.queryWithVariable(data);

		console.log('query_response', query_response?.data);

		exam_result_id =
			set_update == 1
				? query_response?.data?.data?.update_exam_results_by_pk?.id
				: query_response?.data?.data?.insert_exam_results_one?.id;

		exam_result_response =
			set_update == 1
				? query_response?.data?.data?.update_exam_results_by_pk
				: query_response?.data?.data?.insert_exam_results_one;

		result = { ...exam_result_response }; // Set exam result data directly

		// Process subjects array

		if (subject?.length > 0) {
			result.subject = []; // Initialize subject array

			for (const schedule of subject) {
				data = {
					query: `
						query MyQuery {
							exam_subject_results(where: {exam_results_id: {_eq:${exam_result_id}}, subject_code: {_eq:"${schedule?.subject_code}"}}) {
								id
							}
						}
					`,
				};

				vresponse =
					await this.hasuraServiceFromServices.queryWithVariable(
						data,
					);

				exam_result_subjects_id =
					vresponse?.data?.data?.exam_subject_results?.[0]?.id;

				let query;

				if (exam_result_subjects_id) {
					query = `
						mutation UpdateExamResultSubjects {
							update_exam_subject_results_by_pk(pk_columns: {id: ${exam_result_subjects_id}}, _set: {
					`;
				} else {
					query = `
						mutation CreateExamResultSubjects {
							insert_exam_subject_results_one(object: {
								exam_results_id:${exam_result_id},
					`;
				}

				Object.keys(schedule).forEach((key) => {
					if (schedule[key] !== null && schedule[key] !== '') {
						if (key == 'max_marks') {
							query += `${key}: ${schedule[key]}, `;
						} else {
							query += `${key}: "${schedule[key]}", `;
						}
					}
				});

				query = query.slice(0, -2); // Remove trailing comma and space

				query += `
							}) {
								id
								exam_results_id
								subject_name
								subject_code
								max_marks
								theory
								practical
								tma_internal_sessional
								total
								result
							}
						}
					`;

				data = {
					query: `${query}`,
					variables: {},
				};

				const query_response =
					await this.hasuraServiceFromServices.queryWithVariable(
						data,
					);

				const updatedOrCreatedEvent =
					query_response?.data?.data?.[
						exam_result_subjects_id
							? 'update_exam_subject_results_by_pk'
							: 'insert_exam_subject_results_one'
					];

				if (updatedOrCreatedEvent) {
					result.subject.push(updatedOrCreatedEvent); // Push subject data directly to result
				}
			}
		}
		// Update Learner status to Check if status needs to be updated
		if (exam_result_response?.final_result) {
			let status = '';
			if (
				exam_result_response.final_result === 'P' ||
				exam_result_response.final_result === 'PASS'
			) {
				status = '10th_passed';
			} else if (
				exam_result_response.final_result === 'SYC' ||
				exam_result_response.final_result === 'SYCT' ||
				exam_result_response.final_result === 'SYCP' ||
				exam_result_response.final_result === 'XXXX'
			) {
				status = 'pragati_syc';
			}

			// Update program_beneficiaries status
			if (status) {
				const beneficiaryUpdateQuery = `
							mutation UpdateBeneficiaryStatus {
									update_program_beneficiaries(where: { user_id: { _eq: ${exam_result_response.user_id} } }, _set: { status: "${status}" }) {
											affected_rows
									}
							}						
					`;

				const beneficiaryUpdateData = {
					query: beneficiaryUpdateQuery,
					variables: {},
				};

				await this.hasuraServiceFromServices.queryWithVariable(
					beneficiaryUpdateData,
				);
			}
		}
		const beneficiaryUpdateQuery = `
							mutation resultUploadStatusChange {
								update_program_beneficiaries(where: { user_id: { _eq: ${exam_result_response.user_id} } }, _set: { result_upload_status: "uploaded" }) {
									affected_rows
							}
							}						
					`;

		const beneficiaryUpdateData = {
			query: beneficiaryUpdateQuery,
			variables: {},
		};

		await this.hasuraServiceFromServices.queryWithVariable(
			beneficiaryUpdateData,
		);

		return result; // Return the modified result object
	}

	//upload pdf file
	public async base64ToBlob(buffer, userId, res, documentDetails) {
		let fileObject;
		let { document_type, document_sub_type } = documentDetails;

		// Generate a unique filename with timestamp and userId
		const now = new Date();
		const formattedDateTime = now
			.toISOString()
			.slice(0, 19)
			.replace('T', '-'); // YYYY-MM-DD-HH-MM-SS format
		const filename = `${userId}-${formattedDateTime}.pdf`; // Extract file extension

		fileObject = {
			fieldname: 'file',
			mimetype: 'application/pdf',
			encoding: '7bit',
			originalname: filename,
			buffer: buffer,
		};
		let uploadresponse = await this.uploadFileService.addFile(
			fileObject,
			userId,
			document_type,
			document_sub_type,
			res,
			true,
		);

		let document_id: any; // Adjust the type as per your requirement

		if ('data' in uploadresponse && uploadresponse.data) {
			document_id =
				uploadresponse.data.data?.insert_documents?.returning[0]?.id;
		} else {
			// Handle the case where 'data' property is not present
			// or uploadresponse.data is null/undefined
			document_id = null; // Or any other fallback value
		}
		return {
			filename,
			mimeType: 'application/pdf',
			document_id: document_id,
		};
	}

	async getCampRegisteredLearners(body, request, response) {
		let user_id = request?.mw_userid;
		let data;
		let validation_response;
		let result;
		let academic_year_id = request?.mw_academic_year_id;
		let program_id = request?.mw_program_id;
		let role = request?.mw_roles;
		let filter;
		let searchQuery = '';
		let filterStatus = '';
		let boardsearch = '';
		let statussearch = '';
		let filterQueryArray = [];
		const page = isNaN(body.page) ? 1 : parseInt(body.page);
		const limit = isNaN(body.limit) ? -1 : parseInt(body.limit);
		let offset = page > 1 ? limit * (page - 1) : 0;

		if (body.search && body.search !== '') {
			let first_name = body.search.split(' ')[0];
			let last_name = body.search.split(' ')[1] || '';

			if (last_name?.length > 0) {
				filterQueryArray.push(`
				first_name: { _ilike: "%${first_name}%" }, 
				last_name: { _ilike: "%${last_name}%" }
		`);
			} else {
				filterQueryArray.push(
					`first_name: { _ilike: "%${first_name}%" }`,
				);
			}
		}

		if (body?.boardid) {
			boardsearch = `id:{_eq: ${body?.boardid}}`;
		}
		if (body?.examstatus && body?.examstatus.length > 0) {
			statussearch = `result_upload_status:{_eq: "${body?.examstatus}"}`;
		}

		if (body?.district && body?.district.length > 0) {
			filterQueryArray.push(
				`district:{_in: ${JSON.stringify(body?.district)}}`,
			);
		}

		if (body?.block && body?.block.length > 0) {
			//searchQuery = `block:{_in: ${JSON.stringify(body?.block)}}`;
			filterQueryArray.push(
				`block:{_in: ${JSON.stringify(body?.block)}}`,
			);
		}
		if (body?.status && body?.status.length > 0) {
			filterStatus = `final_result:{_in: ${JSON.stringify(
				body?.status,
			)}}`;
		}
		searchQuery = '' + filterQueryArray.join(',') + '';
		if (role?.includes('facilitator')) {
			filter = `{facilitator_id: {_eq: ${user_id}}, program_id: {_eq:${program_id}}, academic_year_id: {_eq:${academic_year_id}}, status: {_in: ["registered_in_camp","10th_passed","pragati_syc"]},bordID:{${boardsearch}
		}}`;
		} else if (role?.includes('staff')) {
			//get organisation_id of the IP
			let query = {
				query: `query MyQuery {
					program_users(where: {academic_year_id: {_eq: ${academic_year_id}}, program_id: {_eq: ${program_id}}, user_id: {_eq:${user_id}}}) {
					  organisation_id
					}
				  }
				  `,
			};

			validation_response =
				await this.hasuraServiceFromServices.queryWithVariable(query);

			let parent_ip =
				validation_response?.data?.data?.program_users?.[0]
					?.organisation_id;

			filter = `{program_id: {_eq:${program_id}}, academic_year_id: {_eq:${academic_year_id}}, status: {_in: ["registered_in_camp","10th_passed","pragati_syc"]},enrollment_number:{_is_null:false},${statussearch},facilitator_user:{program_faciltators:{parent_ip:{_eq:"${parent_ip}"},program_id:{_eq:${program_id}},academic_year_id:{_eq:${academic_year_id}}}},user:{${searchQuery}},bordID:{${boardsearch}
			}, ${
				body?.status && body?.status.length > 0
					? `,exam_results:{${filterStatus}}`
					: ''
			}}
				`;
		}

		data = {
			query: `query MyQuery(${
				limit != -1 ? '$limit:Int,' : ''
			} $offset:Int) {
				program_beneficiaries_aggregate(where: ${filter}) {
					aggregate{
						count
					}
				}
				program_beneficiaries(where: ${filter}, ${limit != -1 ? 'limit: $limit,' : ''}
					offset: $offset) {
				  facilitator_id
					user_id
					enrollment_first_name
					enrollment_middle_name
					enrollment_last_name
					bordID{
						id
						name
					}
				  facilitator_user{
					id
					first_name
					last_name
					middle_name
				   
				  }
				  enrollment_number
					status
					result_upload_status
				  beneficiary_user:user {
				   beneficiary_id: id
					first_name
					middle_name
					last_name
					exam_results(where: {program_id: {_eq: ${program_id}}, academic_year_id: {_eq: ${academic_year_id}},${filterStatus}}) {
					  id
					  board_id
					  program_id
					  academic_year_id
					  board_id
					  enrollment
					  candidate
					  father
					  mother
					  dob
					  course_class
					  exam_year
					  total_marks
					  final_result
					  document_id
					}
				  }
				}
			  }
			  `,
			variables: {
				limit: limit,
				offset: offset,
			},
		};

		validation_response =
			await this.hasuraServiceFromServices.queryWithVariable(data);

		result = validation_response?.data?.data?.program_beneficiaries;
		const count =
			validation_response?.data?.data?.program_beneficiaries_aggregate
				?.aggregate?.count;
		const totalPages = Math.ceil(count / limit);

		if (result?.length > 0) {
			return response.status(200).json({
				message: 'Data Retrieved Successfully',
				limit,
				currentPage: page,
				totalCount: count,
				totalPages,
				data: result,
			});
		} else if (result?.length == 0) {
			return response.status(404).json({
				message: 'Data Not found',
				data: [],
			});
		} else {
			return response.status(500).json({
				message: 'Error getting data',
				data: [],
			});
		}
	}

	async getExamResult(body: any, request: any, response: any) {
		let data;
		let validation_response;
		let program_id = request?.mw_program_id;
		let academic_year_id = request?.mw_academic_year_id;

		data = {
			query: `query MyQuery {
				exam_results(where: {user_id: {_eq:${body?.user_id}}, program_id: {_eq:${program_id}}, board_id:{_eq:${body?.board_id}},academic_year_id: {_eq:${academic_year_id}}, enrollment: {_eq: "${body?.enrollment}"}}) {
				  id
				  program_id
				  academic_year_id
				  board_id
				  enrollment
				  candidate
				  father
				  mother
				  dob
				  course_class
				  exam_year
				  total_marks
				  final_result
				  exam_subject_results {
					id
					exam_results_id
					subject_name
					subject_code
					max_marks
					theory
					practical
					tma_internal_sessional
					total
					result
				  }
				  document_id
				  document {
					id
					context
					context_id
					path
				  }
				}
			  }
			  
			  `,
		};

		validation_response =
			await this.hasuraServiceFromServices.queryWithVariable(data);

		let newQdata = validation_response?.data?.data?.exam_results;

		if (newQdata?.length > 0) {
			return response.status(200).json({
				success: true,
				message: 'Data found successfully!',
				data: newQdata,
			});
		} else {
			return response.status(404).json({
				success: true,
				message: 'Data Not Found',
				data: {},
			});
		}
	}

	public async pdfExtract(file: any, response: any, request: any) {
		const board_name = request?.body?.board_name;
		//first check validations for all inputs
		try {
			//text read
			const result = await this.examResultPattern.extractResultFromPDF(
				file,
				board_name,
			);

			if (result == null) {
				return response
					.status(200)
					.json({ success: false, message: 'INVALID_PDF' });
			} else {
				//upload pdf file and store in exam result
				return response.status(200).json({
					success: true,
					extracted_data: {
						result,
					},
				});
			}
		} catch (error) {
			console.log('error', error);
			return response
				.status(200)
				.json({ success: false, message: 'Failed_Read_PDF' });
		}
	}

	public async resultUpload(file: any, response: any, request: any) {
		let program_id = request?.mw_program_id;
		let academic_year_id = request?.mw_academic_year_id;
		const board_name = request?.body?.board_name;
		const user_id = request?.body?.user_id;
		const board_id = request?.body?.board_id;
		const enrollment = request?.body?.enrollment;
		let validation_result;
		let result_upload_status;
		let update_status_body = {};

		try {
			const result = await this.examResultPattern.extractResultFromPDF(
				file,
				board_name,
			);

			if (result == null) {
				await this.handleUploadAttemptStatus(
					file,
					user_id,
					request,
					response,
				);

				return response
					.status(200)
					.json({ success: false, message: 'INVALID_PDF' });
			} else {
				//check extracted enrollment
				if (enrollment == result?.enrollment) {
					result.user_id = user_id;
					result.board_id = board_id;
					//upload pdf file and get document id
					let document: any = await this.base64ToBlob(
						file.buffer,
						user_id,
						response,
						{
							document_type: 'exam_result',
							document_sub_type: '',
						},
					);
					//console.log('document', document);
					//add document id in results
					let document_id = document?.document_id;
					result.document_id = document_id;
					let examResult = await this.ExamResultUpsert(
						result,
						academic_year_id,
						program_id,
					);
					if (examResult) {
						return response.status(200).json({
							success: true,
							data: examResult,
							document: document,
							extracted_data: {
								result,
							},
						});
					} else {
						return response.status(200).json({
							success: false,
							data: [],
							document: [],
							extracted_data: {
								result,
							},
						});
					}
				} else {
					await this.handleUploadAttemptStatus(
						file,
						user_id,
						request,
						response,
					);
					return response.status(200).json({
						success: false,
						message: 'ENROLLMENT_NOT_MATCH',
					});
				}
			}
		} catch (error) {
			console.log('error', error);
			return response
				.status(200)
				.json({ success: false, message: 'FAILED_READ_PDF' });
		}
	}

	private async handleUploadAttemptStatus(
		file,
		user_id: any,
		request: any,
		response: any,
	): Promise<string> {
		let validation_result_status = await this.uploadAttemptValidationCheck(
			user_id,
		);

		let update_status_body = {
			learner_id: user_id,
			status: validation_result_status,
		};
		await this.updateReportStatus(update_status_body, request);

		await this.uploadFileService.uploadFileDetails(
			file,
			user_id,
			'exam_result',
			'',
			response,
		);

		return validation_result_status;
	}

	async uploadAttemptValidationCheck(user_id) {
		let query;
		let validation_response;
		let validation_result;
		let result_upload_status;
		//first check validations for all inputs

		//get result upload status to determine next result attempt status

		query = `query MyQuery {
			program_beneficiaries(where: {user_id: {_eq: ${user_id}}}){
			  user_id
			  result_upload_status
			}
		  }
		  `;
		validation_response =
			await this.hasuraServiceFromServices.queryWithVariable({
				query: query,
			});

		validation_result =
			validation_response?.data?.data?.program_beneficiaries?.[0]
				?.result_upload_status;

		let attempt_status = [
			'first_time_upload_failed',
			'second_time_upload_failed',
			'assign_to_ip',
		];

		if (validation_result == null || validation_result === '') {
			// If no status is present, start with the first attempt status
			return (result_upload_status = attempt_status[0]);
		} else {
			const currentIndex = attempt_status.indexOf(validation_result);
			if (
				currentIndex !== -1 &&
				currentIndex < attempt_status.length - 1
			) {
				// Move to the next status in the list
				return (result_upload_status =
					attempt_status[currentIndex + 1]);
			} else {
				// If we're at the end of the list or status is not found, fallback to the first status
				return (result_upload_status = attempt_status[0]);
			}
		}
	}

	async updateReportStatus(body: any, request: any) {
		try {
			let program_id = request?.mw_program_id;
			let academic_year_id = request?.mw_academic_year_id;
			let user_id = request?.mw_userid;
			let learner_id = body.learner_id;
			let status = body?.status;

			if (!learner_id || !status) {
				return {
					success: false,
					message: 'Required Learner_id And Status',
				};
			}

			// Check user role
			let role = request?.mw_roles;

			if (role.includes('staff')) {
				// If the user is staff, check if learner_id is under this staff
				const data = {
					query: `query MyQuery6 {
						users(where: {id: {_eq: ${user_id}}}){
							program_users(where: {academic_year_id: {_eq: ${academic_year_id}}, program_id: {_eq: ${program_id}}, user_id: {_eq: ${user_id}}}) {
								organisation_id
								academic_year_id
								program_id
								user_id
							} 
						}
					}`,
				};
				const validation_response =
					await this.hasuraServiceFromServices.queryWithVariable(
						data,
					);

				const organisation_id =
					validation_response?.data?.data?.users?.[0]
						?.program_users?.[0].organisation_id || '';

				const staffValidationQuery = {
					query: `
						query StaffValidationQuery {
							program_beneficiaries(where: { user_id: { _eq: ${learner_id} },facilitator_user: {program_faciltators: {parent_ip: {_eq: "${organisation_id}"}, academic_year_id: {_eq: ${academic_year_id}}, program_id: {_eq: ${program_id}}}}}){
								user_id
							}
						}
					`,
				};

				const staffValidationResponse =
					await this.hasuraServiceFromServices.queryWithVariable(
						staffValidationQuery,
					);

				if (
					!staffValidationResponse?.data?.data
						?.program_beneficiaries[0]?.user_id
				) {
					return {
						success: false,
						message:
							'Forbidden: The learner_id does not belong to the staff user!',
					};
				}
			} else if (role.includes('facilitator')) {
				// If the user is facilitator, check if learner_id is under this facilitator
				const facilitatorValidationQuery = {
					query: `
						query facilitatorValidationQuery {
							program_beneficiaries(where:{user_id: { _eq: ${learner_id} },facilitator_id: {_eq: ${user_id}}, program_id: {_eq:${program_id}}, academic_year_id: {_eq:${academic_year_id}}}) {
								user_id
							}
						}
					`,
				};

				const facilitatorValidationResponse =
					await this.hasuraServiceFromServices.queryWithVariable(
						facilitatorValidationQuery,
					);

				if (
					!facilitatorValidationResponse?.data?.data
						?.program_beneficiaries[0]?.user_id
				) {
					return {
						success: false,
						message:
							'Forbidden: The learner_id does not belong to the Facilitator user!',
					};
				}
			} else {
				// If the user is neither staff nor facilitator, return forbidden error
				return {
					success: false,
					message:
						'Forbidden: You do not have permission to perform this action!',
				};
			}

			// Update the status in program_beneficiaries table
			const updateQuery = {
				query: `
					mutation UpdateprogrambeneficiariesStatus {
						update_program_beneficiaries(where: { user_id: { _eq: ${learner_id} }, academic_year_id: { _eq: ${academic_year_id} }, program_id: { _eq: ${program_id} } }, _set: { result_upload_status: "${status}" }) {
							affected_rows
						}
					}
				`,
			};

			const updateResponse =
				await this.hasuraServiceFromServices.queryWithVariable(
					updateQuery,
				);
			const result =
				updateResponse?.data?.data?.update_program_beneficiaries
					?.affected_rows;

			if (result > 0) {
				return {
					success: true,
					message: 'Status updated successfully!',
				};
			} else {
				return {
					success: false,
					message:
						'No beneficiary found with the provided learner_id!',
				};
			}
		} catch (error) {
			console.error('Error updating status:', error);
			return {
				success: false,
				message: 'Internal Server Error',
			};
		}
	}

	async getExamResultReport(body: any, request: any, response: any) {
		let academic_year_id = request?.mw_academic_year_id;
		let program_id = request?.mw_program_id;
		let user_id = request?.mw_userid;
		let data;
		let result;
		let validation_response;
		let sql;

		data = {
			query: `query MyQuery {
				program_beneficiaries(where: {facilitator_id: {_eq:${user_id}}, academic_year_id: {_eq:${academic_year_id}}, program_id: {_eq:${program_id}}, status: {_in: ["registered_in_camp","10th_passed","pragati_syc"]}}){
				  id
				  user_id
				}
			  }
			  		  
			  
			  `,
		};

		validation_response =
			await this.hasuraServiceFromServices.queryWithVariable(data);

		result = validation_response?.data?.data?.program_beneficiaries;

		let total_learners = result?.length;

		const ids = result.map((beneficiary) => beneficiary?.user_id);

		// Map each element in ids array to a string with parentheses

		const formattedIds = `(${ids.join(',')})`;
		console.log(formattedIds); // Output: (10,19)

		sql = ` SELECT 
    
		SUM(CASE WHEN er.final_result in ('P','PASS') THEN 1 ELSE 0 END) AS "tenth_passed",
		SUM(CASE WHEN er.final_result in('SYC','SYCT','XXXX','SYCP') THEN 1 ELSE 0 END) AS pragati_syc
		
	FROM 
		program_beneficiaries pb
	LEFT JOIN 
		exam_results er ON pb.user_id = er.user_id 
	WHERE 
		pb.facilitator_id = ${user_id} 
		AND pb.academic_year_id = ${academic_year_id}
		AND pb.program_id = ${program_id}
		AND er.user_id IN ${formattedIds}
	
		
	`;

		const result_report_data = (
			await this.hasuraServiceFromServices.executeRawSql(sql)
		)?.result;

		if (result_report_data == undefined) {
			return response.status(404).json({
				status: false,
				message: 'Data not found',
				data: [],
			});
		}

		let result_report_result =
			this.hasuraServiceFromServices.getFormattedData(result_report_data);

		// Calculate not_marked for each instance
		result_report_result.forEach((report) => {
			report.total_learners = total_learners?.toString();
			if (report.tenth_passed == 'NULL') {
				report.tenth_passed = 0;
			}
			if (report.pragati_syc == 'NULL') {
				report.pragati_syc = 0;
			}
			report.not_uploaded = (
				parseInt(total_learners) -
				(parseInt(
					report.tenth_passed !== 'NULL' ? report.tenth_passed : 0,
				) +
					parseInt(
						report.pragati_syc !== 'NULL' ? report.pragati_syc : 0,
					))
			)?.toString();
		});

		return response.status(200).json({
			status: true,
			message: 'Data retrieved successfully',
			data: result_report_result,
		});
	}

	async getExamResultSubject(body: any, request: any, response: any) {
		let data;
		let validation_response;
		let program_id = request?.mw_program_id;
		let academic_year_id = request?.mw_academic_year_id;
		let user_id = request?.mw_userid;
		let learner_id = body.learner_id;
		//validation to check user_id is under the  same program as learner_id or not
		data = {
			query: `query MyQuery6 {
				users(where: {id: {_eq: ${user_id}}}){
				 program_users(where: {academic_year_id: {_eq: ${academic_year_id}}, program_id: {_eq: ${program_id}}, user_id: {_eq: ${user_id}}}) {
					organisation_id
					academic_year_id
					program_id
					user_id
				} 
				}
			}
			  `,
		};
		validation_response =
			await this.hasuraServiceFromServices.queryWithVariable(data);

		const organisation_id =
			validation_response?.data?.data?.users?.[0]?.program_users?.[0]
				.organisation_id || '';
		data = {
			query: `query MyQuery {
				program_beneficiaries(where: {user_id:{_eq:${learner_id}},facilitator_user: {program_faciltators: {parent_ip: {_eq: "${organisation_id}"}, academic_year_id: {_eq: ${academic_year_id}}, program_id: {_eq: ${program_id}}}}}) {
					user_id
				}
				
			  }
			  `,
		};
		validation_response =
			await this.hasuraServiceFromServices.queryWithVariable(data);
		const user =
			validation_response?.data?.data?.program_beneficiaries?.[0]
				?.user_id;
		if (!user) {
			return response.status(422).json({
				success: true,
				message: 'Invalid IP!',
				data: {},
			});
		}
		//take subject id
		data = {
			query: `query MyQuery {
      program_beneficiaries(where: {user_id: {_eq: ${learner_id}}, academic_year_id: {_eq: ${academic_year_id}}, program_id: {_eq: ${program_id}}}) {
        subjects
		enrollment_number
		enrollment_first_name
        enrollment_last_name
        enrollment_middle_name
		enrollment_dob
		is_continued
		exam_fee_date
	    syc_subjects
	    exam_fee_document_id
    user{
      first_name
      middle_name
      last_name
			core_beneficiaries{
        father_first_name
        father_middle_name
        father_last_name
        mother_first_name
        mother_middle_name
        mother_last_name
      }
    }
      }
    } 
      `,
		};

		try {
			validation_response =
				await this.hasuraServiceFromServices.queryWithVariable(data);

			let newQdata =
				validation_response?.data?.data?.program_beneficiaries;

			let subjectsArray = [];

			if (newQdata) {
				for (newQdata of newQdata) {
					try {
						const subjects = JSON.parse(newQdata.subjects);
						//get subject data
						const subjectQuery = {
							query: `query SubjectQuery {
              subjects(where: {id: {_in: [${subjects}]}}) {
               				id
                            name
                            is_theory
                            is_practical
							theory_marks
							practical_marks
							sessional_marks
							total_marks
                            board_id
							code
                            boardById {
                                id
                                name
                            }
              }
            }`,
						};

						const subjectResponse =
							await this.hasuraServiceFromServices.queryWithVariable(
								subjectQuery,
							);

						if (subjectResponse?.data?.data?.subjects) {
							const learnerSubjectData =
								subjectResponse.data.data.subjects.map(
									(subject) => {
										return {
											...subject,
										};
									},
								);
							subjectsArray.push(...learnerSubjectData);
						} else {
							console.warn(
								'Failed to fetch subject details:',
								subjectResponse,
							);
						}
					} catch (error) {
						console.error(
							'Error parsing subjects JSON or fetching subject details:',
							error,
						);
					}
				}
			}

			if (subjectsArray.length > 0) {
				return response.status(200).json({
					success: true,
					message: 'Data found successfully!',
					data: {
						learner_id,
						enrollment_number: newQdata?.enrollment_number,
						enrollment_first_name: newQdata?.enrollment_first_name,
						enrollment_last_name: newQdata?.enrollment_last_name,
						enrollment_middle_name:
							newQdata?.enrollment_middle_name,
						enrollment_dob: newQdata?.enrollment_dob,
						user: newQdata?.user,

						subjectsArray,
					},
				});
			} else {
				return response.status(404).json({
					success: true,
					message: 'Data Not Found',
					data: {},
				});
			}
		} catch (error) {
			console.error('Error fetching exam result subjects:', error);
			return response.status(500).json({
				success: false,
				message: 'Internal Server Error',
			});
		}
	}

	async exportCsv(req: any, body: any, resp: any) {
		try {
			let user = req?.mw_userid;
			const academic_year_id = req.mw_academic_year_id;
			const program_id = req.mw_program_id;
			const variables: any = {};

			let filterQueryArray = [];
			let paramsQueryArray = [];

			if (body.search && body.search !== '') {
				let first_name = body.search.split(' ')[0];
				let last_name = body.search.split(' ')[1] || '';

				if (last_name?.length > 0) {
					filterQueryArray.push(`{_or: [
				{ user:{first_name: { _ilike: "%${first_name}%" }} }
				{user:{ last_name: { _ilike: "%${last_name}%" } }}
				 ]} `);
				} else {
					filterQueryArray.push(`{_or: [
				{ user:{first_name: { _ilike: "%${first_name}%" }} }
				{ user:{last_name: { _ilike: "%${first_name}%" } }}
				 ]} `);
				}
			}

			if (body.hasOwnProperty('state') && body.state.length) {
				paramsQueryArray.push('$state: [String!]');
				filterQueryArray.push('{user:{state: { _in: $state }}}');
				variables.state = body.state;
			}

			if (body.hasOwnProperty('district') && body.district.length) {
				paramsQueryArray.push('$district: [String!]');
				filterQueryArray.push('{user:{district: { _in: $district }}}');
				variables.district = body.district;
			}

			if (body.hasOwnProperty('block') && body.block.length) {
				paramsQueryArray.push('$block: [String!]');
				filterQueryArray.push('user:{{block: { _in: $block }}}');
				variables.block = body.block;
			}

			let filterQuery = '{ _and: [' + filterQueryArray.join(',') + '] }';

			let paramsQuery = '';
			if (paramsQueryArray.length) {
				paramsQuery = '(' + paramsQueryArray.join(',') + ')';
			}
			let sortQuery = `{ user_id: desc }`;
			const data = {
				query: `query MyQuery ${paramsQuery}{
							program_beneficiaries(where: ${filterQuery}, order_by: ${sortQuery}) {
							  facilitator_id
								bordID{
									id
									name
								}
							  facilitator_user{
								id
								first_name
								last_name
								middle_name
								 
							  }
							  enrollment_number
							  beneficiary_user:user {
							   beneficiary_id: id
								first_name
								middle_name
								last_name
								exam_results(where: {program_id: {_eq: ${program_id}}, academic_year_id: {_eq: ${academic_year_id}}}) {
								  id
								  board_id
								  program_id
								  academic_year_id
								  board_id
								  enrollment
								  candidate
								  father
								  mother
								  dob
								  course_class
								  exam_year
								  total_marks
								  final_result
								  document_id
								}
							  }
							}
						  }
						  `,
				variables: variables,
			};

			const hasuraResponse = await this.hasuraServiceFromServices.getData(
				data,
			);
			const allBeneficiaries =
				hasuraResponse?.data?.program_beneficiaries;

			const csvStringifier = createObjectCsvStringifier({
				header: [
					{ id: 'name', title: 'LearnerName' },
					{ id: 'beneficiary_id', title: 'LearnerId' },
					{ id: 'enrollment_number', title: 'Enrollment Number' },
					{ id: 'facilitator_id', title: 'FacilitatorId' },
					{ id: 'facilitator_name', title: 'FacilitatorName' },
					{ id: 'exam_result', title: 'ExamResult' },
				],
			});

			const records = [];
			for (let data of allBeneficiaries) {
				const dataObject = {};
				dataObject[
					'name'
				] = `${data?.beneficiary_user?.first_name} ${data?.beneficiary_user?.last_name}`;
				dataObject[
					'beneficiary_id'
				] = `${data?.beneficiary_user?.beneficiary_id}`;
				dataObject['enrollment_number'] = data?.enrollment_number;
				dataObject['facilitator_id'] = data?.facilitator_id;
				dataObject[
					'facilitator_name'
				] = `${data?.facilitator_user?.first_name} ${data?.facilitator_user?.last_name}`;
				dataObject['exam_result'] =
					data?.beneficiary_user?.exam_results?.[0]?.final_result;
				dataObject['beneficiary_user'] = {
					beneficiary_id: data?.beneficiary_user?.beneficiary_id,
					first_name: data?.beneficiary_user?.first_name,
					middle_name: data?.beneficiary_user?.middle_name,
					last_name: data?.beneficiary_user?.last_name,
					exam_results: data?.beneficiary_user?.exam_results || [],
				};
				records.push(dataObject);
			}
			let fileName = `${
				user?.data?.first_name + '_' + user?.data?.last_name
			}_${new Date().toLocaleDateString().replace(/\//g, '-')}.csv`;
			const fileData =
				csvStringifier.getHeaderString() +
				csvStringifier.stringifyRecords(records);
			resp.header('Content-Type', 'text/csv');
			return resp.attachment(fileName).send(fileData);
		} catch (error) {
			return resp.status(500).json({
				success: false,
				message: 'File Does Not Export!',
				data: {},
			});
		}
	}

	//Update result_update_status
	async updatestatus(body: any, request: any, response: any) {
		try {
			let program_id = request?.mw_program_id;
			let academic_year_id = request?.mw_academic_year_id;
			let user_id = request?.mw_userid;
			let learner_id = body.learner_id;
			let status = body?.status;
			if (!learner_id || !status) {
				return response.status(422).json({
					success: false,
					message: 'Required Learner_id And Status ',
				});
			}
			// Check user role
			let role = request?.mw_roles;

			if (role.includes('staff')) {
				// If the user is staff, check if learner_id is under this staff
				const data = {
					query: `query MyQuery6 {
						users(where: {id: {_eq: ${user_id}}}){
						 program_users(where: {academic_year_id: {_eq: ${academic_year_id}}, program_id: {_eq: ${program_id}}, user_id: {_eq: ${user_id}}}) {
							organisation_id
							academic_year_id
							program_id
							user_id
						} 
						}
					}
						`,
				};
				const validation_response =
					await this.hasuraServiceFromServices.queryWithVariable(
						data,
					);

				const organisation_id =
					validation_response?.data?.data?.users?.[0]
						?.program_users?.[0].organisation_id || '';

				const staffValidationQuery = {
					query: `
						query StaffValidationQuery {
								program_beneficiaries(where: { user_id: { _eq: ${learner_id} },facilitator_user: {program_faciltators: {parent_ip: {_eq: "${organisation_id}"}, academic_year_id: {_eq: ${academic_year_id}}, program_id: {_eq: ${program_id}}}}}){
										user_id
								}
						}
				`,
				};

				const staffValidationResponse =
					await this.hasuraServiceFromServices.queryWithVariable(
						staffValidationQuery,
					);

				if (
					!staffValidationResponse?.data?.data
						?.program_beneficiaries[0]?.user_id
				) {
					return response.status(422).json({
						success: false,
						message:
							'Forbidden: The learner_id does not belong to the staff user!',
					});
				}
			} else if (role.includes('facilitator')) {
				// If the user is facilitator, check if learner_id is under this facilitator
				const facilitatorValidationQuery = {
					query: `
						query facilitatorValidationQuery {
							program_beneficiaries(where:{user_id: { _eq: ${learner_id} },facilitator_id: {_eq: ${user_id}}, program_id: {_eq:${program_id}}, academic_year_id: {_eq:${academic_year_id}}}	) {
										user_id
								}
						}
				`,
				};

				const facilitatorValidationResponse =
					await this.hasuraServiceFromServices.queryWithVariable(
						facilitatorValidationQuery,
					);

				if (
					!facilitatorValidationResponse?.data?.data
						?.program_beneficiaries[0]?.user_id
				) {
					return response.status(422).json({
						success: false,
						message:
							'Forbidden: The learner_id does not belong to the Facilitator user!',
					});
				}
			} else {
				// If the user is neither staff nor facilitator, return forbidden error
				return response.status(422).json({
					success: false,
					message:
						'Forbidden: You do not have permission to perform this action!',
				});
			}
			// Update the status in program_beneficiaries table
			const updateQuery = {
				query: `
                mutation UpdateprogrambeneficiariesStatus {
                    update_program_beneficiaries(where: { user_id: { _eq: ${learner_id} }, academic_year_id: { _eq: ${academic_year_id} }, program_id: { _eq: ${program_id} } }, _set: { result_upload_status: "${status}" }) {
                        affected_rows
                    }
                }
            `,
			};

			const updateResponse =
				await this.hasuraServiceFromServices.queryWithVariable(
					updateQuery,
				);
			const result =
				updateResponse?.data?.data?.update_program_beneficiaries
					?.affected_rows;

			if (result > 0) {
				return response.status(200).json({
					success: true,
					message: 'Status updated successfully!',
				});
			} else {
				return response.status(404).json({
					success: true,
					message:
						'No beneficiary found with the provided learner_id!',
				});
			}
		} catch (error) {
			console.error('Error updating status:', error);
			return response.status(500).json({
				success: false,
				message: 'Internal Server Error',
			});
		}
	}

	//board List
	async getBoardList(resp: any, request: any) {
		let program_id = request?.mw_program_id;
		let academic_year_id = request?.mw_academic_year_id;
		let user_id = request?.mw_userid;
		let data;
		data = {
			query: `query facilitatorValidationQuery {
				program_beneficiaries(where:{facilitator_id: {_eq: ${user_id}}, program_id: {_eq:${program_id}}, academic_year_id: {_eq:${academic_year_id}}}	) {
							user_id
							enrolled_for_board
							exam_fee_document_id
							syc_subjects
							exam_fee_date
							is_continued	
					}
			}      
              `,
		};

		let response = await this.hasuraServiceFromServices.queryWithVariable(
			data,
		);
		let newQdata = response?.data?.data?.program_beneficiaries;

		let boardIds = [];
		for (const beneficiary of newQdata) {
			if (beneficiary?.enrolled_for_board) {
				boardIds = boardIds.concat(beneficiary.enrolled_for_board);
			}
		}
		// Step 2: Combine the board IDs into a unique array
		boardIds = [...new Set(boardIds)];

		// Step 3-7: Process each board ID
		let boardList = [];

		// Step 3: Get board details, subjects, and related events
		const boardQuery = {
			query: `
                    query BoardQuery {
                        boards(where:{id:{_in:[${boardIds}]}}) {
                            id
                            name
                            subjects {
                                id
                                name
                                events(order_by: { start_date: desc },,where:{program_id:{_eq:${program_id}},academic_year_id:{_eq:${academic_year_id}},status:{_eq:"publish"}} limit: 1) {
																	start_date
                                }
                            }
                        }
                    }
                `,
		};

		const boardResponse =
			await this.hasuraServiceFromServices.queryWithVariable(boardQuery);
		const boardData = boardResponse?.data?.data?.boards;
		// Process each board separately
		for (const board of boardData) {
			// Determine the maximum date among all subject events for this board
			let maxDate = null;
			const subjects = board.subjects;

			// Extract events for this board
			const events = subjects.flatMap((subject) => subject.events);

			// Extract all start_date values
			const startDates = events.map(
				(event) => new Date(event.start_date),
			);

			// Find the maximum date if there are any dates
			if (startDates.length > 0) {
				maxDate = new Date(Math.max(...startDates));

				// Add 2 days to the maximum date
				maxDate.setDate(maxDate.getDate() + 2);

				// Format the date to a string
				const maxDateString = maxDate.toISOString().split('T')[0];

				if (maxDateString) {
					boardList.push({
						board: {
							id: board.id,
							name: board.name,
							subjects: board.subjects,
						},
						addedMaxDate: maxDateString,
					});
				}
			} else {
				// No events found for this board
				boardList.push({
					board: {
						id: board.id,
						name: board.name,
						subjects: board.subjects,
					},
					addedMaxDate: null,
				});
			}
		}
		// Step 8: Send the board list in the response
		if (boardList.length > 0) {
			return resp.status(200).json({
				success: true,
				message: 'Board list retrieved successfully!',
				data: boardList,
			});
		} else {
			return resp.status(422).json({
				success: false,
				message: 'No boards found for the selected learners!',
				data: [],
			});
		}
	}

	async updateExamStatus(body: any, request: any, response: any) {
		let user_id = request?.mw_userid;
		let academic_year_id = request?.mw_academic_year_id;
		let program_id = request?.mw_program_id;

		body.updated_by = user_id;
		if (!user_id) {
			return response.status(422).json({
				message: 'Invalid User Entity',
				data: null,
			});
		}

		let vquery = `query MyQuery {
			program_beneficiaries(where: {academic_year_id: {_eq:${academic_year_id}}, program_id: {_eq:${program_id}}, user_id: {_eq:${body?.user_id}}, facilitator_id: {_eq:${user_id}}}){
			  id
			  user_id
			  facilitator_id
			}
		  }
		  `;

		const vresponse = await this.hasuraServiceFromServices.getData({
			query: vquery,
		});

		let id = vresponse?.data?.program_beneficiaries?.[0]?.id;

		if (!id) {
			return response.status(422).json({
				success: false,
				message: 'Unauthorised access !',
				data: {},
			});
		}

		let query = '';
		Object.keys(body).forEach((e) => {
			if (body[e] !== undefined && body[e] !== null && body[e] !== '') {
				if (e === 'render') {
					query += `${e}: ${body[e]}, `;
				} else if (Array.isArray(body[e])) {
					query += `${e}: "${JSON.stringify(body[e]).replace(
						/"/g,
						'\\"',
					)}", `;
				} else if (typeof body[e] === 'boolean') {
					query += `${e}: ${body[e]}, `;
				} else {
					query += `${e}: "${body[e]}", `;
				}
			}
		});

		let data = {
			query: `
      mutation UpdateProgramBeneficiaries($id:Int!) {
        update_program_beneficiaries_by_pk(
            pk_columns: {
              id: $id
            },
            _set: {
                ${query}
            }
        ) {
          id
        }
    }
    `,
			variables: {
				id: id,
			},
		};

		let validation_result =
			await this.hasuraServiceFromServices.queryWithVariable(data);

		let result =
			validation_result?.data?.data?.update_program_beneficiaries_by_pk;

		if (result) {
			return response.status(200).json({
				success: true,
				message: 'Status updated successfully!',
				data: result,
			});
		} else {
			return response.status(500).json({
				success: false,
				message: 'Unable to update status !',
				data: {},
			});
		}
	}
}
