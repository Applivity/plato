using System;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Plato.Vs.Bridge
{
    /// <summary>
    /// Newline-delimited JSON: requests carry id + method + params, responses
    /// carry id and one of result or error, notifications carry method + params.
    /// </summary>
    internal static class Protocol
    {
        public static string Request(long id, string method, object? parameters) =>
            JsonConvert.SerializeObject(new
            {
                id,
                method,
                @params = parameters ?? new { },
            });

        public static string Notification(string method, object? parameters) =>
            JsonConvert.SerializeObject(new
            {
                method,
                @params = parameters ?? new { },
            });

        public static string Success(long id, object? result) =>
            JsonConvert.SerializeObject(new { id, result = result ?? new { } });

        public static string Failure(long id, long code, string message) =>
            JsonConvert.SerializeObject(new
            {
                id,
                error = new { code, message },
            });

        public static JObject? Parse(string line)
        {
            try
            {
                return JObject.Parse(line);
            }
            catch (JsonException)
            {
                return null;
            }
        }

        public static long? IdOf(JObject message)
        {
            var token = message["id"];
            return token != null && token.Type == JTokenType.Integer
                ? token.Value<long>()
                : (long?)null;
        }
    }
}
