from pathlib import Path
import tempfile
import unittest
from maestro_transport import is_transport_failure

BASE = '<testsuites><testsuite><testcase><failure>{}</failure></testcase></testsuite></testsuites>'


class ClassifierTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.p = Path(self.tmp.name)
        self.report = self.p / 'report.xml'
        self.out = self.p / 'console.log'
        self.logs = self.p / 'tests'
        (self.logs / 'run1').mkdir(parents=True)
        self.report.write_text(BASE.format('Unknown error'))
        self.out.write_text('Unknown error')

    def classify(self):
        return is_transport_failure(self.report, self.out, self.logs)

    def test_unknown_without_log_is_not_retryable(self):
        self.assertFalse(self.classify())

    def test_exact_unknown_and_status_log_is_retryable(self):
        (self.logs/'run1'/'maestro.log').write_text('xcTestDriverStatusCheck: [Failed] transport check')
        self.assertTrue(self.classify())

    def test_exact_unknown_and_connection_refusal_is_retryable(self):
        (self.logs/'run1'/'maestro.log').write_text('Failed to connect to /127.0.0.1:55102')
        self.assertTrue(self.classify())

    def test_assertion_with_transport_log_is_not_retryable(self):
        self.report.write_text(BASE.format('Assertion is false: open-menu'))
        (self.logs/'run1'/'maestro.log').write_text('Failed to connect to /127.0.0.1:55102')
        self.assertFalse(self.classify())

    def test_other_unknown_log_is_not_retryable(self):
        (self.logs/'run1'/'maestro.log').write_text('UI timeout unrelated to driver')
        self.assertFalse(self.classify())

    def test_missing_report_is_not_retryable(self):
        self.report.unlink()
        self.out.write_text('DeviceUnreachableException')
        self.assertFalse(self.classify())

    def test_explicit_transport_in_report_is_retryable(self):
        for signature in ('DeviceUnreachableException','Transport unreachable','Unreachable while processing deviceInfo'):
            self.report.write_text(BASE.format(signature))
            self.assertTrue(self.classify(), signature)

    def test_explicit_transport_in_console_is_retryable(self):
        self.out.write_text('Unreachable while processing deviceInfo')
        self.assertTrue(self.classify())

    def test_exactness_enforced(self):
        self.report.write_text(BASE.format('Unknown error and assertion failed'))
        (self.logs/'run1'/'maestro.log').write_text('xcTestDriverStatusCheck: [Failed]')
        self.assertFalse(self.classify())

    def test_newest_log_only(self):
        import os
        old = self.logs/'run1'/'maestro.log'
        old.write_text('Failed to connect to /127.0.0.1:50908')
        (self.logs/'run2').mkdir()
        new = self.logs/'run2'/'maestro.log'
        new.write_text('ordinary log')
        os.utime(old,(1,1))
        os.utime(new,(2,2))
        self.assertFalse(self.classify())


if __name__ == '__main__':
    unittest.main()
