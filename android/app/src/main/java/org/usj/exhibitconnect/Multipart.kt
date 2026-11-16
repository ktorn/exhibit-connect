package org.usj.exhibitconnect

import java.io.File
import java.io.RandomAccessFile
import java.nio.charset.Charset
import kotlin.math.min

data class MultipartFile(
    val filename: String,
    val mime: String?,
    val size: Long,
)

object Multipart {
    fun extractFile(temp: File, contentType: String, dest: File): MultipartFile {
        val boundary = Regex("boundary=(?:\"([^\"]+)\"|([^;]+))", RegexOption.IGNORE_CASE)
            .find(contentType)
            ?.let { it.groupValues[1].ifBlank { it.groupValues[2] }.trim() }
            ?: throw IllegalArgumentException("not_multipart")
        RandomAccessFile(temp, "r").use { raf ->
            val size = raf.length()
            val headLen = min(size, 64 * 1024L).toInt()
            val head = ByteArray(headLen)
            raf.seek(0)
            raf.readFully(head)
            val sep = "\r\n\r\n".toByteArray()
            val sepAt = indexOf(head, sep)
            if (sepAt < 0) throw IllegalArgumentException("not_multipart")
            val headerText = String(head, 0, sepAt, Charset.forName("UTF-8"))
            val filename = Regex(
                """filename\*=(?:UTF-8'')?([^;\r\n]+)|filename="([^"]+)"|filename=([^;\r\n]+)""",
                RegexOption.IGNORE_CASE,
            ).find(headerText)?.let {
                val raw = it.groupValues[1].ifBlank { it.groupValues[2].ifBlank { it.groupValues[3] } }.trim()
                try {
                    java.net.URLDecoder.decode(raw, "UTF-8")
                } catch (_: Exception) {
                    raw
                }
            } ?: "file"
            val mime = Regex("""Content-Type:\s*([^\r\n]+)""", RegexOption.IGNORE_CASE)
                .find(headerText)
                ?.groupValues
                ?.get(1)
                ?.trim()
            val dataStart = sepAt + 4L
            val tailLen = min(size, 64 * 1024L).toInt()
            val tail = ByteArray(tailLen)
            raf.seek(size - tailLen)
            raf.readFully(tail)
            val endToken = "\r\n--$boundary".toByteArray()
            val rel = lastIndexOf(tail, endToken)
            if (rel < 0) throw IllegalArgumentException("not_multipart")
            val dataEnd = size - tailLen + rel
            if (dataEnd < dataStart) throw IllegalArgumentException("not_multipart")
            dest.parentFile?.mkdirs()
            dest.outputStream().use { out ->
                raf.seek(dataStart)
                var left = dataEnd - dataStart
                val buf = ByteArray(64 * 1024)
                while (left > 0) {
                    val n = raf.read(buf, 0, min(buf.size.toLong(), left).toInt())
                    if (n <= 0) break
                    out.write(buf, 0, n)
                    left -= n
                }
            }
            return MultipartFile(filename, mime, dataEnd - dataStart)
        }
    }

    private fun indexOf(hay: ByteArray, needle: ByteArray): Int {
        outer@ for (i in 0..hay.size - needle.size) {
            for (j in needle.indices) {
                if (hay[i + j] != needle[j]) continue@outer
            }
            return i
        }
        return -1
    }

    private fun lastIndexOf(hay: ByteArray, needle: ByteArray): Int {
        outer@ for (i in hay.size - needle.size downTo 0) {
            for (j in needle.indices) {
                if (hay[i + j] != needle[j]) continue@outer
            }
            return i
        }
        return -1
    }
}
