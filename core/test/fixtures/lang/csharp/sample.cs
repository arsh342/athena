using System;

namespace Demo
{
    public static class MathUtil
    {
        /// <summary>Adds numbers.</summary>
        public static int Add(int a, int b)
        {
            return a + b;
        }

        public static int Clamp(int v, int min, int max)
        {
            if (v < min) return min;
            return v > max ? max : v;
        }
    }

    public struct Point
    {
        public int X;
        public int Y;
    }

    public class Runner
    {
        public void Run()
        {
            // comment block

            Func<int, int> square = x =>
            {
                return x * x;
            };
            int Local(int n)
            {
                return square(n);
            }
            Console.WriteLine(Local(3));
        }
    }
}
