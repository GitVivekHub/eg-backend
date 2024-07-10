import { Module } from '@nestjs/common';
import { AttendancesModule } from 'src/attendances/attendances.module';
import { Method } from 'src/common/method/method';
import { UserModule } from 'src/user/user.module';
import { AwsRekognitionModule } from '../services/aws-rekognition/aws-rekognition.module';
import { HasuraModule } from '../services/hasura/hasura.module';
import { CampEndCron } from './campEnd.cron';
import { FaAttendanceProcessingCron } from './faAttendanceProcessing.cron';
import { FaFaceIndexingCron } from './faFaceIndexing.cron';
import { FaUserIndexingCron } from './faUserIndexing.cron';
import { PrepareCertificateHtmlCron } from './prepareCertificateHtml.cron';
import { OnestStatusUpdateCron } from './onestStatusUpdate.cron';
@Module({
	imports: [
		AwsRekognitionModule,
		HasuraModule,
		AttendancesModule,
		UserModule,
	],
	providers: [
		FaUserIndexingCron,
		FaFaceIndexingCron,
		FaAttendanceProcessingCron,
		PrepareCertificateHtmlCron,
		CampEndCron,
		Method,
		OnestStatusUpdateCron,
	],
})
export class CronModule {}
